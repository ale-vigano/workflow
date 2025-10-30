import { start } from 'workflow/api';
import { simpleWorkflow } from '@/app/workflows/simple';

export async function POST(req: Request) {
  console.log('[API] ===== SIMPLE WORKFLOW TEST START =====');

  const body = await req.json().catch(() => ({ value: 5 }));
  const inputValue = typeof body?.value === 'number' ? body.value : 5;

  console.log('[API] ===== IMPORTING LOCAL WORKFLOW =====');
  console.log('[API] simpleWorkflow:', simpleWorkflow);
  console.log('[API] typeof simpleWorkflow:', typeof simpleWorkflow);

  if ((simpleWorkflow as any)?.workflowId) {
    console.log(
      '[API] ✅ workflowId found:',
      (simpleWorkflow as any).workflowId
    );
  } else {
    console.log('[API] ❌ workflowId NOT found in simpleWorkflow');
  }

  console.log('[API] ===== STARTING WORKFLOW =====');
  console.log('[API] Calling start() with:', simpleWorkflow, 'and input:', [
    { value: inputValue },
  ]);

  try {
    const run = await start(simpleWorkflow, [{ value: inputValue }]);
    console.log('[API] ✅ Workflow started successfully, runId:', run.runId);

    const result = await run.returnValue;
    console.log('[API] ✅ Workflow completed, result:', result);

    return Response.json({ success: true, runId: run.runId, result });
  } catch (error) {
    console.log('[API] ❌ Error executing workflow:', error);
    throw error;
  }
}

export async function GET() {
  return Response.json({
    message: 'Simple workflow test endpoint',
    usage: 'POST { "value": 5 }',
  });
}
