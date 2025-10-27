import { NextBuilder } from '@workflow/cli/dist/lib/builders/next-build';
import type { NextConfig } from 'next';
import path from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

// TODO: type for workflows.directories feature
// type WorkflowDirectoryOption = string;

type WorkflowLibraryOption = string;

const WORKFLOW_DIRECTIVE_REGEX = /['"]use (workflow|step)['"]/;
const SUPPORTED_LIBRARY_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.tsx',
]);
const IGNORED_LIBRARY_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
]);

function toPosixPath(target: string) {
  let normalized = target.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized) && normalized[2] !== '/') {
    normalized = `${normalized.slice(0, 2)}/${normalized.slice(2)}`;
  }
  return normalized;
}

function scanWorkflowDirectiveFiles(rootDir: string) {
  const results: string[] = [];
  const stack: string[] = [rootDir];
  const visited = new Set<string>();

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(current);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      const base = path.basename(current);
      if (IGNORED_LIBRARY_DIRS.has(base)) {
        continue;
      }
      try {
        const entries = readdirSync(current);
        for (const entry of entries) {
          stack.push(path.join(current, entry));
        }
      } catch {
        // ignore unreadable directories
      }
      continue;
    }

    if (!stats.isFile()) continue;

    const ext = path.extname(current).toLowerCase();
    if (!SUPPORTED_LIBRARY_EXTENSIONS.has(ext)) continue;

    try {
      const content = readFileSync(current, 'utf8');
      if (WORKFLOW_DIRECTIVE_REGEX.test(content)) {
        results.push(toPosixPath(path.resolve(current)));
      }
    } catch {
      // ignore unreadable files
    }
  }

  return results;
}

function resolveLibraryIncludes(identifier: string) {
  const files = new Set<string>();
  const dirs = new Set<string>();

  const processDirectory = (dirPath: string) => {
    const normalizedDir = toPosixPath(path.resolve(dirPath));
    dirs.add(normalizedDir);
    const discovered = scanWorkflowDirectiveFiles(dirPath);
    for (const item of discovered) {
      files.add(item);
    }
  };

  const looksLikePath =
    identifier.startsWith('.') ||
    identifier.startsWith('/') ||
    identifier.includes('\\');

  if (looksLikePath) {
    const absolute = path.resolve(process.cwd(), identifier);
    if (!existsSync(absolute)) {
      console.warn(
        '[workflow-next] No se encontró la ruta de librería',
        absolute
      );
      return { files: Array.from(files), dirs: Array.from(dirs) };
    }
    try {
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        processDirectory(absolute);
      } else {
        files.add(toPosixPath(absolute));
      }
    } catch (error) {
      console.warn(
        '[workflow-next] No se pudo inspeccionar la librería',
        absolute,
        error
      );
    }
    return { files: Array.from(files), dirs: Array.from(dirs) };
  }

  try {
    const resolvedEntry = require.resolve(identifier);
    files.add(toPosixPath(resolvedEntry));

    try {
      const pkgJsonPath = require.resolve(
        path.join(identifier, 'package.json')
      );
      processDirectory(path.dirname(pkgJsonPath));
    } catch {
      processDirectory(path.dirname(resolvedEntry));
    }
  } catch (error) {
    console.warn(
      '[workflow-next] No se pudo resolver la librería',
      identifier,
      error
    );
  }

  return { files: Array.from(files), dirs: Array.from(dirs) };
}

export function withWorkflow({
  workflows,
  ...nextConfig
}: NextConfig & {
  workflows?: {
    embedded?: {
      port?: number;
      dataDir?: string;
    };
    // TODO: support workflows.directories to include local workflow directories
    // directories?: WorkflowDirectoryOption[];
    libraries?: WorkflowLibraryOption[];
  };
}) {
  // Automatically add libraries to transpilePackages
  const workflowLibraries = workflows?.libraries ?? [];
  if (workflowLibraries.length > 0) {
    const existingTranspilePackages = nextConfig.transpilePackages ?? [];
    nextConfig.transpilePackages = [
      ...new Set([...existingTranspilePackages, ...workflowLibraries]),
    ];
  }

  if (!process.env.VERCEL_DEPLOYMENT_ID) {
    if (!process.env.WORKFLOW_TARGET_WORLD) {
      process.env.WORKFLOW_TARGET_WORLD = 'embedded';
      process.env.WORKFLOW_EMBEDDED_DATA_DIR = '.next/workflow-data';
    }
    const maybePort = workflows?.embedded?.port;
    if (maybePort) {
      process.env.PORT = maybePort.toString();
    }
  } else {
    if (!process.env.WORKFLOW_TARGET_WORLD) {
      process.env.WORKFLOW_TARGET_WORLD = 'vercel';
    }
  }

  const loaderPath = require.resolve('./loader');

  // configure the loader if turbopack is being used
  if (!nextConfig.turbopack) {
    nextConfig.turbopack = {};
  }
  if (!nextConfig.turbopack.rules) {
    nextConfig.turbopack.rules = {};
  }
  const existingRules = nextConfig.turbopack.rules as any;

  nextConfig.turbopack.rules = {
    ...existingRules,
    '*.tsx': {
      loaders: [...(existingRules['*.tsx']?.loaders || []), loaderPath],
    },
    '*.ts': {
      loaders: [...(existingRules['*.ts']?.loaders || []), loaderPath],
    },
    '*.jsx': {
      loaders: [...(existingRules['*.jsx']?.loaders || []), loaderPath],
    },
    '*.js': {
      loaders: [...(existingRules['*.js']?.loaders || []), loaderPath],
    },
  };

  // configure the loader for webpack
  const existingWebpackModify = nextConfig.webpack;
  nextConfig.webpack = (...args) => {
    const [webpackConfig] = args;
    if (!webpackConfig.module) {
      webpackConfig.module = {};
    }
    if (!webpackConfig.module.rules) {
      webpackConfig.module.rules = [];
    }
    // loaders in webpack apply bottom->up so ensure
    // ours comes before the default swc transform
    webpackConfig.module.rules.push({
      test: /.*\.(mjs|cjs|cts|ts|tsx|js|jsx)$/,
      loader: loaderPath,
    });

    return existingWebpackModify
      ? existingWebpackModify(...args)
      : webpackConfig;
  };

  return async function buildConfig(phase: string) {
    // only run this in the main process so it only runs once
    // as Next.js uses child processes for different builds
    if (
      !process.env.WORKFLOW_NEXT_PRIVATE_BUILT &&
      phase !== 'phase-production-server'
    ) {
      const shouldWatch = process.env.NODE_ENV === 'development';
      // TODO: support for workflows.directories to scan local directories
      // const additionalDirs: string[] = workflows?.directories ?? [];
      const workflowLibraries: string[] = workflows?.libraries ?? [];

      const libraryFiles: string[] = [];
      const libraryDirs: string[] = [];

      for (const identifier of workflowLibraries) {
        if (typeof identifier !== 'string') {
          continue;
        }
        const { files: includeFiles, dirs: includeDirs } =
          resolveLibraryIncludes(identifier);
        for (const file of includeFiles) {
          if (!libraryFiles.includes(file)) {
            libraryFiles.push(file);
          }
          const parentDir = toPosixPath(path.dirname(file));
          if (!libraryDirs.includes(parentDir)) {
            libraryDirs.push(parentDir);
          }
        }
        for (const dir of includeDirs) {
          const normalizedDir = toPosixPath(dir);
          if (!libraryDirs.includes(normalizedDir)) {
            libraryDirs.push(normalizedDir);
          }
          const parentDir = toPosixPath(path.dirname(dir));
          if (!libraryDirs.includes(parentDir)) {
            libraryDirs.push(parentDir);
          }
        }
      }

      const loaderIncludePaths = Array.from(
        new Set([...libraryDirs, ...libraryFiles])
      );

      const libraryModulesFromDirs = libraryDirs.map(
        (dir) => `${dir}/**/*.{ts,tsx,js,jsx,mjs,cjs}`
      );

      const builderIncludeModules = Array.from(
        new Set([...libraryFiles, ...libraryModulesFromDirs])
      );

      if (loaderIncludePaths.length > 0) {
        process.env.WORKFLOW_LOADER_INCLUDE =
          JSON.stringify(loaderIncludePaths);
      }

      const workflowBuilder = new NextBuilder({
        watch: shouldWatch,
        // discover workflows from pages/app entries
        dirs: ['pages', 'app', 'src/pages', 'src/app'],
        workingDir: process.cwd(),
        buildTarget: 'next',
        workflowsBundlePath: '',
        stepsBundlePath: '',
        externalPackages: [
          ...require('next/dist/lib/server-external-packages.json'),
          ...(nextConfig.serverExternalPackages || []),
        ],
        includeModules: [...builderIncludeModules],
      });

      await workflowBuilder.build();
      process.env.WORKFLOW_NEXT_PRIVATE_BUILT = '1';
    }

    return nextConfig;
  };
}
