import { transform } from '@swc/core';
import path from 'node:path';

type IncludeConfig = {
  paths: string[];
  hasEntries: boolean;
};

const includeConfig: IncludeConfig = (() => {
  const envValue = process.env.WORKFLOW_LOADER_INCLUDE;
  console.log('[Next.js Loader] 🔧 WORKFLOW_LOADER_INCLUDE:', envValue);
  if (!envValue) {
    console.log('[Next.js Loader] ❌ WORKFLOW_LOADER_INCLUDE no está definido');
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

  // Check if this is a library file that should be processed
  // Look for workflow library files in node_modules
  if (normalizedFilename.includes('/node_modules/@worklow-npm-library/')) {
    console.log(
      '[workflow-next] Procesando archivo de librería:',
      normalizedFilename
    );
    return true;
  }

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

  // Check if this is a library file
  const isLibraryFile = filename.includes('workflow-npm-library');
  if (isLibraryFile) {
    console.log('[Next.js Loader] 📚 ARCHIVO DE LIBRERÍA DETECTADO:', filename);
  }

  const normalizedSource = source.toString();

  if (!isPathIncluded(filename)) {
    if (isLibraryFile) {
      console.log(
        '[Next.js Loader] ❌ ARCHIVO DE LIBRERÍA NO INCLUIDO:',
        filename
      );
    }
    return normalizedSource;
  }

  if (isLibraryFile) {
    console.log('[Next.js Loader] ✅ ARCHIVO DE LIBRERÍA INCLUIDO:', filename);
  }

  // only apply the transform if file needs it
  if (!normalizedSource.match(/(use step|use workflow)/)) {
    return normalizedSource;
  }

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

  // Buscar workflowId en el código transformado
  const workflowIdMatch = result.code.match(
    /workflowId\s*:\s*["']([^"']+)["']/
  );
  if (workflowIdMatch) {
    console.log('[workflow-next] ✅ workflowId inyectado:', workflowIdMatch[1]);
  } else {
    console.log('[workflow-next] ❌ NO workflowId inyectado en:', filename);
  }
  return result.code;
}
