async function multiplyStep(a: number, b: number): Promise<number> {
  'use step';

  const result = a * b;
  console.log(`[STEP] Multiplying ${a} * ${b} = ${result}`);

  return result;
}

export async function simpleWorkflow(input: { value: number }) {
  'use workflow';

  console.log('[WORKFLOW] Simple workflow started with input:', input);

  const step1 = await multiplyStep(input.value, 2);
  console.log('[WORKFLOW] Step 1 result:', step1);

  const step2 = await multiplyStep(step1, 3);
  console.log('[WORKFLOW] Step 2 result:', step2);

  return {
    input: input.value,
    step1Result: step1,
    step2Result: step2,
    finalResult: step2,
    success: true,
  };
}
