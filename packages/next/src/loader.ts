import { transform } from '@swc/core';
import path from 'node:path';

type IncludeConfig = {
  paths: string[];
  hasEntries: boolean;
};

const includeConfig: IncludeConfig = (() => {
  const envValue = process.env.WORKFLOW_LOADER_INCLUDE;
  if (!envValue) {
    return { paths: [], hasEntries: false };
  }

  try {
    const parsed = JSON.parse(envValue);
    if (!Array.isArray(parsed)) {
      return { paths: [], hasEntries: false };
    }

    const normalized = parsed
      .map((entry) => {
        if (typeof entry !== 'string') {
          return null;
        }
        return normalizePath(entry);
      })
      .filter((entry): entry is string => Boolean(entry));

    return { paths: normalized, hasEntries: normalized.length > 0 };
  } catch (error) {
    console.warn(
      '[workflow-next] No se pudo interpretar WORKFLOW_LOADER_INCLUDE:',
      error
    );
    return { paths: [], hasEntries: false };
  }
})();

function normalizePath(target: string) {
  let resolved = path.resolve(target);
  if (resolved.includes('..')) {
    resolved = path.normalize(resolved);
  }
  let normalized = resolved.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized) && normalized[2] !== '/') {
    normalized = `${normalized.slice(0, 2)}/${normalized.slice(2)}`;
  }
  return normalized;
}

function isPathIncluded(filename: string) {
  if (!includeConfig.hasEntries) {
    return true;
  }

  const normalizedFilename = normalizePath(filename);
  for (const includePath of includeConfig.paths) {
    const normalizedInclude = includePath;
    if (normalizedFilename === normalizedInclude) {
      return true;
    }
    const relative = path.relative(normalizedInclude, normalizedFilename);
    if (
      relative === '' ||
      (!relative.startsWith('..') && !path.isAbsolute(relative))
    ) {
      return true;
    }
  }

  return false;
}

// This loader applies the "use workflow"/"use step"
// client transformation
export default async function workflowLoader(
  this: {
    resourcePath: string;
  },
  source: string | Buffer,
  sourceMap: any
): Promise<string> {
  const filename = this.resourcePath;
  const normalizedSource = source.toString();

  if (!isPathIncluded(filename)) {
    return normalizedSource;
  }

  // only apply the transform if file needs it
  if (!normalizedSource.match(/(use step|use workflow)/)) {
    return normalizedSource;
  }

  console.log(
    '[workflow-next] Transformando archivo con loader cc2:',
    filename
  );

  const isTypeScript = filename.endsWith('.ts') || filename.endsWith('.tsx');
  const isTsx = filename.endsWith('.tsx');

  // Normalize filename to use forward slashes for consistent workflowId generation
  const normalizedFilename = normalizePath(filename);

  // Transform with SWC
  const result = await transform(normalizedSource, {
    filename: normalizedFilename,
    jsc: {
      parser: {
        syntax: isTypeScript ? 'typescript' : 'ecmascript',
        tsx: isTsx,
      },
      target: 'es2022',
      experimental: {
        plugins: [
          [require.resolve('@workflow/swc-plugin'), { mode: 'client' }],
        ],
      },
    },
    minify: false,
    inputSourceMap: sourceMap,
    sourceMaps: true,
    inlineSourcesContent: true,
  });

  return result.code;
}
