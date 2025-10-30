import { uppercaseStep } from '../steps/uppercase';

const WORKFLOW_KEY = 'library:workbench';

async function runWorkbenchLibraryWorkflow(input) {
  'use workflow';

  if (typeof uppercaseStep !== 'function') {
    throw new Error('uppercaseStep is not a function. Steps export failed.');
  }

  const result = await uppercaseStep(input.value);

  // Verificación adicional: el step debe haber agregado el prefijo
  const isStepProcessed = result.upper.startsWith('[STEP-PROCESSED]');

  return {
    ok: true,
    workflow: WORKFLOW_KEY,
    echo: result.input,
    upper: result.upper,
    stepProcessed: isStepProcessed, // Verificación de que el step funcionó
    processedAt: result.processedAt,
  };
}

export { runWorkbenchLibraryWorkflow };
