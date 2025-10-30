import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import enhancedResolveOriginal from 'enhanced-resolve';
import type { Plugin } from 'esbuild';
import { applySwcTransform } from './apply-swc-transform.js';

const enhancedResolve = promisify(enhancedResolveOriginal);

export const jsTsRegex = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// Matches: 'use workflow'; "use workflow"; 'use step'; "use step"; at line start with optional whitespace
export const useWorkflowPattern = /^\s*(['"])use workflow\1;?\s*$/m;
export const useStepPattern = /^\s*(['"])use step\1;?\s*$/m;

// parent -> child relationship
export const importParents = new Map<string, string>();

// check if a parent has a child in it's import chain
// e.g. if a dependency needs to be bundled because it has
// a 'use workflow/'use step' directive in it
export function parentHasChild(parent: string, childToFind: string) {
  let child: string | undefined;
  let currentParent: string | undefined = parent;
  const visited = new Set<string>();

  do {
    if (currentParent) {
      // Detect circular imports to prevent infinite loop
      if (visited.has(currentParent)) {
        break;
      }
      visited.add(currentParent);
      child = importParents.get(currentParent);
    }

    if (child === childToFind) {
      return true;
    }
    currentParent = child;
  } while (child && currentParent);

  return false;
}

export function createDiscoverEntriesPlugin(state: {
  discoveredSteps: string[];
  discoveredWorkflows: string[];
}): Plugin {
  return {
    name: 'discover-entries-esbuild-plugin',
    setup(build) {
      // minimal environment log to help diagnose Windows path issues
      console.log(
        `[DISCOVER PLUGIN] env platform=${process.platform} sep="${path.sep}"`
      );

      const isWorkflowish = (p: string | undefined) => {
        if (!p) {
          return false;
        }
        // Only log for explicit workflow locations or alias imports
        return (
          p.startsWith('@/') ||
          p.includes(`${path.sep}workflows${path.sep}`) ||
          p.includes('/workflows/') ||
          p.endsWith(`${path.sep}workflows${path.sep}simple.ts`) ||
          p.endsWith('/workflows/simple.ts')
        );
      };

      build.onResolve({ filter: jsTsRegex }, async (args) => {
        try {
          const resolved = await enhancedResolve(args.resolveDir, args.path);
          if (resolved) {
            importParents.set(args.importer, resolved);
            if (
              isWorkflowish(args.path) ||
              isWorkflowish(args.importer) ||
              isWorkflowish(resolved)
            ) {
              console.log(
                `[DISCOVER PLUGIN] resolve: path="${args.path}" -> resolved="${resolved}" from="${args.importer}"`
              );
            }
          }
        } catch (error) {
          if (args.path.startsWith('@/') || isWorkflowish(args.importer)) {
            console.log(
              `[DISCOVER PLUGIN] resolve-failed: path="${args.path}" from="${args.importer}"`
            );
          }
        }
        return null;
      });

      // Handle TypeScript and JavaScript files
      build.onLoad({ filter: jsTsRegex }, async (args) => {
        try {
          // Determine the loader based on the output
          let loader: 'js' | 'jsx' = 'js';
          const isTypeScript =
            args.path.endsWith('.ts') || args.path.endsWith('.tsx');
          if (!isTypeScript && args.path.endsWith('.jsx')) {
            loader = 'jsx';
          }
          const source = await readFile(args.path, 'utf8');
          const hasUseWorkflow = useWorkflowPattern.test(source);
          const hasUseStep = useStepPattern.test(source);

          if (hasUseWorkflow) {
            state.discoveredWorkflows.push(args.path);
            console.log(`[DISCOVER PLUGIN] use-workflow in: ${args.path}`);
          }

          if (hasUseStep) {
            state.discoveredSteps.push(args.path);
            console.log(`[DISCOVER PLUGIN] use-step in: ${args.path}`);
          }

          if (!hasUseWorkflow && !hasUseStep && isWorkflowish(args.path)) {
            // log only when file looks like a workflow location but has no directive
            console.log(`[DISCOVER PLUGIN] no-directive in: ${args.path}`);
          }

          const { code: transformedCode } = await applySwcTransform(
            args.path,
            source,
            false
          );

          return {
            contents: transformedCode,
            loader,
          };
        } catch (_) {
          // ignore trace errors during discover phase
          return {
            contents: '',
            loader: 'js',
          };
        }
      });
    },
  };
}
