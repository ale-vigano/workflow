import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { WorkflowConfig } from '../config/types.js';
// Importar el builder desde src para testing
import { NextBuilder } from './next-build.js';

function verifyWorkflowRegistrationInBundle(bundleContent: string): boolean {
  // Verify that the bundle contains the workflow registration logic

  // Check for the registration map initialization
  if (
    !bundleContent.includes(
      'globalThis.__private_workflows = /* @__PURE__ */ new Map()'
    )
  ) {
    return false;
  }

  // Check for the registration logic that handles both direct workflowId and fallback
  if (!bundleContent.includes('if (item?.workflowId)')) {
    return false;
  }

  if (
    !bundleContent.includes(
      'globalThis.__private_workflows.set(item.workflowId, item)'
    )
  ) {
    return false;
  }

  if (!bundleContent.includes('const __maybeId = __WF_FALLBACK?.[item.name]')) {
    return false;
  }

  if (
    !bundleContent.includes(
      'globalThis.__private_workflows.set(__maybeId, item)'
    )
  ) {
    return false;
  }

  return true;
}

describe('Workflows registration without Next.js', () => {
  const testDir = resolve(process.cwd(), '.test-workflows-register');
  const appDir = join(testDir, 'app');
  const outDir = join(appDir, '.well-known/workflow/v1/flow');

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('registra workflow local (OK)', async () => {
    // Arrange: create a local workflow file with 'use workflow'
    const localWorkflowFile = join(testDir, 'src/local-workflow.ts');
    await mkdir(dirname(localWorkflowFile), { recursive: true });
    await writeFile(
      localWorkflowFile,
      [
        'export async function runLocalWorkflow() {',
        "  'use workflow'",
        '  return { ok: true }',
        '}',
        '',
      ].join('\n')
    );

    // Entry that imports the local workflow so discoverEntries can find it
    const entryFile = join(testDir, 'src/entry-local.ts');
    await writeFile(
      entryFile,
      [
        "import { runLocalWorkflow } from './local-workflow'",
        '// reference to keep it in bundle',
        'export const keep = runLocalWorkflow',
        '',
      ].join('\n')
    );

    const config: WorkflowConfig = {
      buildTarget: 'next',
      dirs: ['app'],
      workingDir: testDir,
      stepsBundlePath: '',
      workflowsBundlePath: '',
      watch: false,
      externalPackages: [],
    } as any;

    const builder = new NextBuilder(config);

    const outfile = join(outDir, 'route.js');

    // Act: build only the workflows bundle using the protected method
    const createWorkflowsBundle = (builder as any).createWorkflowsBundle.bind(
      builder
    );
    await createWorkflowsBundle({
      inputFiles: [entryFile],
      outfile,
      format: 'cjs', // Runs inside the VM which expects cjs
      bundleFinalOutput: false,
    });

    const bundleContent = await readFile(outfile, 'utf-8');

    // Assert: bundle contains correct workflow registration logic
    const hasRegistrationLogic =
      verifyWorkflowRegistrationInBundle(bundleContent);
    expect(hasRegistrationLogic).toBe(true);
  });

  it('registra workflow de librería con fallback (solucionado)', async () => {
    // Arrange: use the workbench library index with namespace re-exports
    const libIndex = resolve(
      process.cwd(),
      '..',
      '..',
      'workbench',
      'workflow-npm-library',
      'src',
      'index.ts'
    ).replace(/\\/g, '/');

    // Entry that imports the library workflows via its index and references the workflow symbol
    const entryFile = join(testDir, 'src/entry-lib.ts');
    await mkdir(dirname(entryFile), { recursive: true });
    await writeFile(
      entryFile,
      [
        `import { Workflows } from '${libIndex}'`,
        '// reference to keep it in bundle and avoid tree-shaking',
        'export const keep = Workflows?.runWorkbenchLibraryWorkflow',
        '',
      ].join('\n')
    );

    const config: WorkflowConfig = {
      buildTarget: 'next',
      dirs: ['app'],
      workingDir: testDir,
      stepsBundlePath: '',
      workflowsBundlePath: '',
      watch: false,
      externalPackages: [],
    } as any;

    const builder = new NextBuilder(config);

    const outfile = join(outDir, 'route.js');

    // Act: build the workflows bundle
    const createWorkflowsBundle = (builder as any).createWorkflowsBundle.bind(
      builder
    );
    await createWorkflowsBundle({
      inputFiles: [entryFile],
      outfile,
      format: 'cjs', // Runs inside the VM which expects cjs
      bundleFinalOutput: false,
    });

    const bundleContent = await readFile(outfile, 'utf-8');

    // Assert: bundle contains correct workflow registration logic (including fallback)
    const hasRegistrationLogic =
      verifyWorkflowRegistrationInBundle(bundleContent);
    expect(hasRegistrationLogic).toBe(true);
  });
});
