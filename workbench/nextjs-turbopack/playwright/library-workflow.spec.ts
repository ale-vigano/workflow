import { test, expect } from '@playwright/test';

test.describe('Workflow Library endpoint', () => {
  test('ejecuta el workflow de la librería y devuelve el resultado esperado', async ({
    request,
  }) => {
    const response = await request.post('/api/library-test', {
      data: { value: 'library-test' },
    });

    console.log('response', response);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({ success: true });
    expect(body.result).toMatchObject({
      ok: true,
      workflow: 'library:workbench',
      echo: 'library-test',
      upper: '[STEP-PROCESSED] LIBRARY-TEST', // Verifica transformación del step
      stepProcessed: true, // Verifica que el step se ejecutó correctamente
    });

    // Verificaciones adicionales específicas
    expect(body.result.upper).toBe('[STEP-PROCESSED] LIBRARY-TEST');
    expect(body.result.stepProcessed).toBe(true);
    expect(typeof body.result.processedAt).toBe('number');
  });
});
