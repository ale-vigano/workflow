import { readFile } from 'node:fs/promises';
import enhancedResolveOrig from 'enhanced-resolve';
import type { Plugin } from 'esbuild';
import { relative } from 'path';
import { promisify } from 'util';
import {
  applySwcTransform,
  type WorkflowManifest,
} from './apply-swc-transform.js';
import {
  jsTsRegex,
  parentHasChild,
} from './discover-entries-esbuild-plugin.js';

export interface SwcPluginOptions {
  mode: 'step' | 'workflow' | 'client';
  entriesToBundle?: string[];
  outdir?: string;
  tsPaths?: Record<string, string[]>;
  tsBaseUrl?: string;
  workflowManifest?: WorkflowManifest;
}

const NODE_RESOLVE_OPTIONS = {
  dependencyType: 'commonjs',
  modules: ['node_modules'],
  exportsFields: ['exports'],
  importsFields: ['imports'],
  conditionNames: ['node', 'require'],
  descriptionFiles: ['package.json'],
  extensions: ['.ts', '.mts', '.cjs', '.js', '.json', '.node'],
  enforceExtensions: false,
  symlinks: true,
  mainFields: ['main'],
  mainFiles: ['index'],
  roots: [],
  fullySpecified: false,
  preferRelative: false,
  preferAbsolute: false,
  restrictions: [],
};

const NODE_ESM_RESOLVE_OPTIONS = {
  ...NODE_RESOLVE_OPTIONS,
  dependencyType: 'esm',
  conditionNames: ['node', 'import'],
};

export function createSwcPlugin(options: SwcPluginOptions): Plugin {
  return {
    name: 'swc-workflow-plugin',
    setup(build) {
      // everything is external unless explicitly configured
      // to be bundled
      const cjsResolver = promisify(
        enhancedResolveOrig.create(NODE_RESOLVE_OPTIONS)
      );
      const esmResolver = promisify(
        enhancedResolveOrig.create(NODE_ESM_RESOLVE_OPTIONS)
      );

      const enhancedResolve = async (context: string, path: string) => {
        try {
          return await esmResolver(context, path);
        } catch (_) {
          return cjsResolver(context, path);
        }
      };

      build.onResolve({ filter: /.*/ }, async (args) => {
        if (!options.entriesToBundle) {
          return null;
        }

        try {
          let resolvedPath: string | false | undefined = args.path;

          // handle local imports e.g. ./hello or ../another
          if (args.path.startsWith('.')) {
            resolvedPath = await enhancedResolve(args.resolveDir, args.path);
          } else {
            resolvedPath = await enhancedResolve(
              // `args.resolveDir` is not used here to ensure we only
              // externalize packages that can be resolved in the
              // project's working directory e.g. a nested dep can't
              // be externalized as we won't be able to resolve it once
              // it's parent has been bundled
              build.initialOptions.absWorkingDir || process.cwd(),
              args.path
            );
          }

          if (!resolvedPath) return null;

          // Normalize the resolved path to use forward slashes for consistent comparison
          const normalizedResolvedPath = resolvedPath.replace(/\\/g, '/');

          // Check if this is an import from a library package (like @ekairos/story)
          // If it's a relative import within a library package, we should include it in the bundle
          // Also check for packages/story which is the local path when using npm link
          const isLibraryPackage =
            normalizedResolvedPath.includes('@ekairos/story') ||
            normalizedResolvedPath.includes('workflow-npm-library') ||
            normalizedResolvedPath.includes('/packages/story/');

          // If this is a relative import and the resolved path is within a library package, include it in the bundle
          if (isLibraryPackage && args.path.startsWith('.')) {
            // Include this file in the bundle since it's an internal import within the library
            return null;
          }

          for (const entryToBundle of options.entriesToBundle) {
            if (normalizedResolvedPath === entryToBundle) {
              return null;
            }

            // if the current entry imports a child that needs
            // to be bundled then it needs to also be bundled so
            // that the child can have our transform applied
            if (parentHasChild(normalizedResolvedPath, entryToBundle)) {
              return null;
            }
          }

          // For node_modules packages, use the package name (args.path)
          // For local file paths (relative or absolute), use relative path from outdir
          const isNodeModule =
            resolvedPath &&
            (resolvedPath.includes('/node_modules/') ||
              resolvedPath.includes('\\node_modules\\'));

          const isFilePath =
            args.path.startsWith('.') || args.path.startsWith('/');

          return {
            external: true,
            path: isNodeModule
              ? args.path // Use package name for node_modules (e.g., "eventsource-parser")
              : isFilePath
                ? relative(options.outdir || '', resolvedPath)
                : args.path,
          };
        } catch (_) {}
        return null;
      });

      // Handle TypeScript and JavaScript files
      build.onLoad({ filter: jsTsRegex }, async (args) => {
        console.log('[SWC Plugin] 🔧 Procesando:', args.path);

        // Check if this is a library file
        const isLibraryFile = args.path.includes('workflow-npm-library');
        if (isLibraryFile) {
          console.log(
            '[SWC Plugin] 📚 ARCHIVO DE LIBRERÍA DETECTADO:',
            args.path
          );
        }

        // Determine if this is a TypeScript file
        const isTypeScript =
          args.path.endsWith('.ts') || args.path.endsWith('.tsx');

        try {
          // Determine the loader based on the output
          let loader: 'js' | 'jsx' = 'js';
          if (!isTypeScript && args.path.endsWith('.jsx')) {
            loader = 'jsx';
          }
          const source = await readFile(args.path, 'utf8');

          if (isLibraryFile) {
            console.log('[SWC Plugin] 📚 CONTENIDO DEL ARCHIVO DE LIBRERÍA:');
            console.log(
              '[SWC Plugin] 📚 Longitud:',
              source.length,
              'caracteres'
            );
            console.log(
              '[SWC Plugin] 📚 Primeras 200 caracteres:',
              source.substring(0, 200)
            );
            console.log(
              '[SWC Plugin] 📚 Contiene "use workflow":',
              source.includes("'use workflow'")
            );
            console.log('[SWC Plugin] 📚 Archivo completo:', source);
            console.log('[SWC Plugin] 📚 ARCHIVO LEÍDO CORRECTAMENTE');
          }

          // Normalize filename to use forward slashes for consistent workflowId generation
          const normalizedFilename = args.path.replace(/\\/g, '/');

          if (isLibraryFile) {
            console.log('[SWC Plugin] 📚 EJECUTANDO TRANSFORMACIÓN SWC...');
          }

          const { code: transformedCode, workflowManifest } =
            await applySwcTransform(
              normalizedFilename,
              source,
              options.mode,
              // we need to provide the tsconfig/jsconfig
              // alias via swc so that we can resolve them
              // with our custom resolve logic
              {
                paths: options.tsPaths,
                baseUrl: options.tsBaseUrl,
              }
            );

          if (isLibraryFile) {
            console.log('[SWC Plugin] 📚 TRANSFORMACIÓN SWC COMPLETADA');
            console.log(
              '[SWC Plugin] 📚 Código transformado longitud:',
              transformedCode.length
            );
            console.log('[SWC Plugin] 📚 Workflow manifest:', workflowManifest);
          }

          if (!options.workflowManifest) {
            options.workflowManifest = {};
          }
          options.workflowManifest.workflows = Object.assign(
            options.workflowManifest.workflows || {},
            workflowManifest.workflows
          );
          options.workflowManifest.steps = Object.assign(
            options.workflowManifest.steps || {},
            workflowManifest.steps
          );

          return {
            contents: transformedCode,
            loader,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          console.error(
            `❌ SWC transform error in ${args.path}:`,
            errorMessage
          );
          return {
            errors: [
              {
                text: `SWC transform failed: ${errorMessage}`,
                location: { file: args.path, line: 0, column: 0 },
              },
            ],
          };
        }
      });
    },
  };
}
