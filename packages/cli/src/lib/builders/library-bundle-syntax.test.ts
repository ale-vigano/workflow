import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import type { WorkflowConfig } from '../config/types.js';
import { NextBuilder } from './next-build.js';

describe('Library bundle syntax compatibility', () => {
  const testDir = resolve(process.cwd(), '.test-library-syntax');
  const appDir = join(testDir, 'app');
  const outDir = join(appDir, '.well-known/workflow/v1/step');

  beforeEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('archivos de librería con "use step" se incluyen en bundle (no se externalizan)', async () => {
    // Arrange: Create a step file in library directory with ES6 export syntax
    const libStepFile = join(
      testDir,
      'node_modules',
      'some-lib',
      'steps',
      'test-step.ts'
    );
    await mkdir(dirname(libStepFile), { recursive: true });
    await writeFile(
      libStepFile,
      [
        'export async function testStep(value: string) {',
        "  'use step'",
        '  return {',
        '    input: value,',
        '    processed: true,',
        '  };',
        '}',
        '',
      ].join('\n')
    );

    // Create an entry file that references the library
    const entryFile = join(testDir, 'src', 'entry.ts');
    await mkdir(dirname(entryFile), { recursive: true });
    await writeFile(
      entryFile,
      [
        '// This would normally import from the library',
        "// import { testStep } from 'some-lib/steps/test-step'",
        '// But for this test we just need the file to exist',
        "export const dummy = 'test';",
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

    // Act: Get input files and discover step entries
    const getInputFiles = (builder as any).getInputFiles.bind(builder);
    const discoverEntries = (builder as any).discoverEntries.bind(builder);

    const inputFiles = await getInputFiles();
    // Add the library file to input files to simulate discovery
    inputFiles.push(libStepFile);

    const { discoveredSteps } = await discoverEntries(
      inputFiles,
      dirname(libStepFile)
    );

    // Assert: Library step file should be discovered
    const normalizedLibStepFile = libStepFile.replace(/\\/g, '/');
    expect(discoveredSteps).toContain(normalizedLibStepFile);
  });

  it('bundle generado no contiene sintaxis ES6 export raw de archivos de librería', async () => {
    // Arrange: Create a simple bundle that imports a library file
    const libWorkflowFile = join(
      testDir,
      'node_modules',
      'some-lib',
      'workflows',
      'test-workflow.ts'
    );
    await mkdir(dirname(libWorkflowFile), { recursive: true });
    await writeFile(
      libWorkflowFile,
      [
        'export async function testWorkflow(input: any) {',
        "  'use workflow'",
        '  return { result: input.value };',
        '}',
        '',
      ].join('\n')
    );

    // Create an entry file that references the workflow
    const entryFile = join(testDir, 'src', 'entry.ts');
    await mkdir(dirname(entryFile), { recursive: true });
    await writeFile(
      entryFile,
      [
        '// Reference to keep the workflow file in consideration',
        "export const dummy = 'test';",
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

    // Act: Create workflows bundle
    const createWorkflowsBundle = (builder as any).createWorkflowsBundle.bind(
      builder
    );
    await createWorkflowsBundle({
      inputFiles: [entryFile, libWorkflowFile], // Include library file directly
      outfile,
      format: 'esm',
      bundleFinalOutput: false,
    });

    // Read the generated bundle
    const bundleContent = await readFile(outfile, 'utf-8');

    // Assert: Bundle should contain the transformed workflow function (not raw ES6 export)
    expect(bundleContent).toContain('testWorkflow');

    // Assert: Bundle should NOT contain raw ES6 export syntax for library functions
    // (This would be the source of the "Unexpected token 'export'" error)
    expect(bundleContent).not.toMatch(/export async function testWorkflow/);
  });

  it('builder detecta correctamente archivos de librería como workflow-npm-library', async () => {
    // Arrange: Create files in the expected library directory structure
    const libWorkflowFile = join(
      testDir,
      'workbench',
      'workflow-npm-library',
      'src',
      'workflows',
      'lib-workflow.ts'
    );
    await mkdir(dirname(libWorkflowFile), { recursive: true });
    await writeFile(
      libWorkflowFile,
      [
        'export async function libWorkflow(input: any) {',
        "  'use workflow'",
        '  return input;',
        '}',
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

    // Act: Create the logic that detects library workflow files
    const getInputFiles = (builder as any).getInputFiles.bind(builder);
    const inputFiles = await getInputFiles();
    inputFiles.push(libWorkflowFile);

    const { discoveredWorkflows } = await (builder as any).discoverEntries(
      inputFiles,
      dirname(libWorkflowFile)
    );

    // Assert: Library workflow file should be detected
    const normalizedLibWorkflowFile = libWorkflowFile.replace(/\\/g, '/');
    expect(discoveredWorkflows).toContain(normalizedLibWorkflowFile);

    // This file would then be included in libraryWorkflowFiles and entriesToBundle
    const libraryWorkflowFiles = discoveredWorkflows.filter((file: string) =>
      file.includes('workflow-npm-library')
    );
    expect(libraryWorkflowFiles).toContain(normalizedLibWorkflowFile);
  });
});
