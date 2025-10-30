import { start } from 'workflow/api';
import { Workflows } from '@worklow-npm-library';

export async function POST(req: Request) {
  console.log('[API] ===== LIBRARY TEST INICIO =====');

  const body = await req.json().catch(() => ({ value: 'module-test' }));
  const input = typeof body?.value === 'string' ? body.value : 'module-test';

  console.log('[API] ===== IMPORTANDO WORKFLOWS =====');
  console.log('[API] Workflows:', Workflows);
  console.log(
    '[API] Workflows.runWorkbenchLibraryWorkflow:',
    Workflows.runWorkbenchLibraryWorkflow
  );
  console.log(
    '[API] typeof Workflows.runWorkbenchLibraryWorkflow:',
    typeof Workflows.runWorkbenchLibraryWorkflow
  );

  if (Workflows.runWorkbenchLibraryWorkflow?.workflowId) {
    console.log(
      '[API] ✅ workflowId encontrado:',
      Workflows.runWorkbenchLibraryWorkflow.workflowId
    );
  } else {
    console.log(
      '[API] ❌ workflowId NO encontrado en Workflows.runWorkbenchLibraryWorkflow'
    );
  }

  console.log('[API] ===== INICIANDO WORKFLOW =====');
  console.log(
    '[API] Llamando start() con:',
    Workflows.runWorkbenchLibraryWorkflow,
    'y input:',
    [{ value: input }]
  );

  try {
    const run = await start(Workflows.runWorkbenchLibraryWorkflow, [
      { value: input },
    ]);
    console.log('[API] ✅ Workflow iniciado exitosamente, runId:', run.runId);

    const result = await run.returnValue;
    console.log('[API] ✅ Workflow completado, result:', result);

    return Response.json({ success: true, runId: run.runId, result });
  } catch (error) {
    console.log('[API] ❌ Error ejecutando workflow:', error);
    throw error;
  }
}

export async function GET() {
  return Response.json({
    message: 'Workflow library test endpoint',
    usage: 'POST { "value": "text" }',
  });
}
