import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { NextBuilder } from './builder.js';
import type { NextConfig } from 'next';
import semver from 'semver';

function looksLikePath(identifier: string): boolean {
  return (
    identifier.startsWith('.') ||
    identifier.startsWith('/') ||
    identifier.includes('\\')
  );
}

function resolveLibraryDir(
  identifier: string,
  workingDir: string
): string | undefined {
  if (looksLikePath(identifier)) {
    const absolute = isAbsolute(identifier)
      ? identifier
      : resolve(workingDir, identifier);
    if (!existsSync(absolute)) {
      console.warn(
        '[workflow-next] Unable to resolve library path',
        identifier
      );
      return undefined;
    }
    return absolute;
  }

  let packageJsonPath: string | undefined;
  try {
    packageJsonPath = require.resolve(`${identifier}/package.json`, {
      paths: [workingDir],
    });
  } catch (error) {
    const workspaceRoot = join(workingDir, '..', '..');
    const workspaceDirs = ['workbench', 'packages'];

    for (const workspaceDir of workspaceDirs) {
      const workspacePath = join(workspaceRoot, workspaceDir);
      if (!existsSync(workspacePath)) {
        continue;
      }
      const packagePath = join(workspacePath, identifier.replace('@', ''));
      const candidate = join(packagePath, 'package.json');
      if (existsSync(candidate)) {
        packageJsonPath = candidate;
        break;
      }
    }

    if (!packageJsonPath) {
      const fallback = join(
        workingDir,
        'node_modules',
        identifier,
        'package.json'
      );
      if (existsSync(fallback)) {
        packageJsonPath = fallback;
      }
    }

    if (!packageJsonPath) {
      console.warn(
        '[workflow-next] Failed to resolve workflow library',
        identifier,
        error
      );
      return undefined;
    }
  }

  const packageDir = dirname(packageJsonPath);
  const srcDir = join(packageDir, 'src');

  return existsSync(srcDir) ? srcDir : packageDir;
}

function resolveLibraryDirs(
  libraries: string[] | undefined,
  workingDir: string
): string[] {
  if (!libraries || libraries.length === 0) {
    return [];
  }

  const resolved = new Set<string>();
  for (const identifier of libraries) {
    if (typeof identifier !== 'string' || identifier.trim() === '') {
      continue;
    }
    const libraryDir = resolveLibraryDir(identifier, workingDir);
    if (libraryDir) {
      resolved.add(libraryDir);
    }
  }
  return Array.from(resolved);
}

export function withWorkflow(
  nextConfigOrFn:
    | NextConfig
    | ((
        phase: string,
        ctx: { defaultConfig: NextConfig }
      ) => Promise<NextConfig>),
  {
    workflows,
  }: {
    workflows?: {
      embedded?: {
        port?: number;
        dataDir?: string;
      };
      libraries?: string[];
    };
  } = {}
) {
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

  return async function buildConfig(
    phase: string,
    ctx: { defaultConfig: NextConfig }
  ) {
    const loaderPath = require.resolve('./loader');
    const workingDir = process.cwd();
    const libraryDirs = resolveLibraryDirs(workflows?.libraries, workingDir);

    let nextConfig: NextConfig;

    if (typeof nextConfigOrFn === 'function') {
      nextConfig = await nextConfigOrFn(phase, ctx);
    } else {
      nextConfig = nextConfigOrFn;
    }
    // shallow clone to avoid read-only on top-level
    nextConfig = Object.assign({}, nextConfig);

    // configure the loader if turbopack is being used
    if (!nextConfig.turbopack) {
      nextConfig.turbopack = {};
    }
    if (!nextConfig.turbopack.rules) {
      nextConfig.turbopack.rules = {};
    }
    const existingRules = nextConfig.turbopack.rules as any;
    const nextVersion = require('next/package.json').version;
    const supportsTurboCondition = semver.gte(nextVersion, 'v16.0.0');

    for (const key of ['*.tsx', '*.ts', '*.jsx', '*.js']) {
      nextConfig.turbopack.rules[key] = {
        ...(supportsTurboCondition
          ? {
              condition: {
                ...existingRules[key]?.condition,
                any: [
                  ...(existingRules[key]?.condition.any || []),
                  {
                    content: /(use workflow|use step)/,
                  },
                ],
              },
            }
          : {}),
        loaders: [...(existingRules[key]?.loaders || []), loaderPath],
      };
    }

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
    // only run this in the main process so it only runs once
    // as Next.js uses child processes for different builds
    if (
      !process.env.WORKFLOW_NEXT_PRIVATE_BUILT &&
      phase !== 'phase-production-server'
    ) {
      const shouldWatch = process.env.NODE_ENV === 'development';
      const workflowBuilder = new NextBuilder({
        watch: shouldWatch,
        // discover workflows from pages/app entries
        dirs: ['pages', 'app', 'src/pages', 'src/app'],
        workingDir,
        buildTarget: 'next',
        workflowsBundlePath: '', // not used in base
        stepsBundlePath: '', // not used in base
        webhookBundlePath: '', // node used in base
        libraryDirs,
        externalPackages: [
          ...require('next/dist/lib/server-external-packages.json'),
          ...(nextConfig.serverExternalPackages || []),
        ],
      });

      await workflowBuilder.build();
      process.env.WORKFLOW_NEXT_PRIVATE_BUILT = '1';
    }

    return nextConfig;
  };
}
