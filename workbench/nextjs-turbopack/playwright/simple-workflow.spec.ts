import { test, expect } from '@playwright/test';

test.describe('Simple Local Workflow endpoint', () => {
  test('executes local workflow with step and returns expected result', async ({
    request,
  }) => {
    const response = await request.post('/api/simple-test', {
      data: { value: 5 },
    });

    console.log('Response status:', response.status());
    expect(response.status()).toBe(200);

    const body = await response.json();
    console.log('Response body:', body);

    expect(body).toMatchObject({ success: true });
    expect(body.result).toMatchObject({
      input: 5,
      step1Result: 10,
      step2Result: 30,
      finalResult: 30,
      success: true,
    });

    expect(body.result.step1Result).toBe(10);
    expect(body.result.step2Result).toBe(30);
    expect(body.result.finalResult).toBe(30);
    expect(body.result.success).toBe(true);
  });

  test('executes workflow with different input value', async ({ request }) => {
    const response = await request.post('/api/simple-test', {
      data: { value: 3 },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.result.input).toBe(3);
    expect(body.result.step1Result).toBe(6);
    expect(body.result.step2Result).toBe(18);
  });
});
