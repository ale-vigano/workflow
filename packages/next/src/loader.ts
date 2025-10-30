import { transform } from '@swc/core';

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
  console.log(`[WORKFLOW LOADER] Processing file: ${filename}`);

  const normalizedSource = source.toString();

  // only apply the transform if file needs it
  const workflowMatch = normalizedSource.match(/(use step|use workflow)/);
  if (!workflowMatch) {
    console.log(
      `[WORKFLOW LOADER] No "use workflow" or "use step" found in ${filename}, skipping transformation`
    );
    return normalizedSource;
  }

  console.log(
    `[WORKFLOW LOADER] Found "${workflowMatch[0]}" in ${filename}, applying transformation`
  );

  const isTypeScript = filename.endsWith('.ts') || filename.endsWith('.tsx');
  const isTsx = filename.endsWith('.tsx');

  console.log(
    `[WORKFLOW LOADER] File type detected - TypeScript: ${isTypeScript}, TSX: ${isTsx}`
  );

  // Transform with SWC
  console.log(`[WORKFLOW LOADER] Starting SWC transformation for ${filename}`);
  const transformStart = Date.now();
  const result = await transform(normalizedSource, {
    filename,
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

  const transformDuration = Date.now() - transformStart;
  console.log(
    `[WORKFLOW LOADER] Transformation completed for ${filename} in ${transformDuration}ms`
  );
  console.log(
    `[WORKFLOW LOADER] Output code length: ${result.code.length} characters`
  );

  return result.code;
}
