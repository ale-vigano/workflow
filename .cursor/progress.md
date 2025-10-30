# Next.js Loader Library Detection - Progress

## Estado: Preparación Completa ✅

### ✅ Completado
1. **Rama limpia creada**: `test/next-loader-library-detection-clean` desde `main`
2. **Workbench copiado**: `workbench/nextjs-turbopack` desde `feature/workflow-and-step-as-libraries-on-nextjs`
3. **Test library copiado**: `workbench/workflow-npm-library` desde feature branch
4. **Tests E2E existentes**:
   - `playwright/library-workflow.spec.ts` - Test que verifica workflow de librería en runtime
5. **Tests nuevos creados**:
   - `playwright/build-detection.spec.ts` - Tests para verificar detección en build

## Estructura del Workbench

### Archivos Clave
- `next.config.ts`: Configurado con `libraries: ['@worklow-npm-library']`
- `app/api/library-test/route.ts`: Endpoint que importa y ejecuta workflow de librería
- `workflows/`: Workflows locales del workbench (deben funcionar siempre)

### Test Library (`workflow-npm-library`)
- `src/workflows/workbench-library.ts`: Workflow con "use workflow"
- `src/steps/uppercase.ts`: Step con "use step"

## Tests Implementados

### 1. `library-workflow.spec.ts` (E2E - Existente)
**Objetivo**: Verificar que el workflow de la librería se ejecuta correctamente en runtime
- ✅ Test existente que espera respuesta 200
- ✅ Verifica que el workflow devuelve el resultado esperado
- ✅ Verifica que el step fue transformado correctamente

**Estado**: Debe fallar hasta que la detección de librerías funcione

### 2. `build-detection.spec.ts` (Nuevo)
**Objetivo**: Verificar detección durante el build
- Build CON libraries: Debe funcionar
- Build SIN libraries: Debe funcionar solo con workflows locales
- Verificar detección de directivas "use workflow" y "use step"

## Próximos Pasos

### Fase 1: Tests Unitarios del Loader
Crear tests unitarios para verificar:
1. `WORKFLOW_LOADER_INCLUDE` se configura correctamente
2. Loader detecta archivos de librerías correctamente
3. Loader detecta archivos locales correctamente
4. Transformación SWC se aplica correctamente a ambos tipos

### Fase 2: Ejecutar Tests y Documentar Fallos
1. Ejecutar `pnpm test:e2e` para ver estado actual
2. Documentar qué funciona y qué no
3. Identificar qué cambios se necesitan

### Fase 3: Implementar Fixes
Basado en los resultados de los tests, implementar las correcciones necesarias.

## Notas
- El workbench está listo para ejecutar tests
- La configuración actual usa `@worklow-npm-library` como librería de prueba
- Los workflows locales en `workflows/` deben funcionar independientemente de la configuración de librerías
\n## Resultados de pruebas (30 Oct 2025)\n- Comando: pnpm test:e2e\n- Resultado: 7 tests pasados, 1 test fallido\n- Test fallido: playwright/build-detection.spec.ts › Build WITH libraries configuration (esperado que falle porque falta soporte a libraries)\n- Motivo exacto: next.config.ts actual no contiene clave 'libraries', el test detecta esa ausencia\n- Tests que pasan: incluyen el flujo local y el endpoint de la librería (actualmente responde 200)\n
\n- Build workbench (pnpm --filter nextjs-turbopack build) falla: Turbopack no puede resolver '..\\..\\..\\..\\..\\..\\..\\packages\\workflow\\dist\\index.js' cuando next.config.ts no transpila el paquete 'workflow'.
\n- Builds ejecutados manualmente (Windows):\n  - pnpm --filter workflow exec tsc (ok) + chmod via node\n  - pnpm --filter @workflow/core run build\n  - pnpm --filter @workflow/cli exec tsc + chmod\n  - pnpm --filter @workflow/next run build\n  - pnpm --filter @workflow/errors run build\n  - pnpm --filter @workflow/world run build\n  - pnpm --filter @workflow/world-local run build\n  - pnpm --filter @workflow/world-vercel run build\n  - pnpm --filter @workflow/web run build\n  - pnpm --filter @workflow/swc-plugin build (falló: script ./build.sh requiere bash/cargo wasm en Windows)

## Actualización 30 Oct 2025 - Compatibilidad Windows 🛠️
- Problema identificado: los bundles generados en Windows introducían rutas con `\\`, provocando que `virtual-entry.js` contuviera secuencias inválidas (`\\p`) y esbuild fallara con `Syntax error "p"`, dejando workflows locales sin registrar.
- Archivos ajustados:
  - `packages/cli/src/lib/builders/base-builder.ts`: Normalización POSIX de rutas al generar imports virtuales de workflows y steps.
  - `packages/cli/src/lib/builders/swc-esbuild-plugin.ts`: Normalización POSIX en los paths marcados como externos por el plugin.
- Resultado: `pnpm playwright test simple-workflow.spec.ts --reporter=line` pasa en Windows y el bundle incluye `app/workflows/simple.ts`.
