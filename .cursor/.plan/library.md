Goal

Validar que `workflow/next` soporte correctamente librerías externas (con workflows/steps marcados) utilizando el workbench `nextjs-turbopack` como entorno de prueba.

# Plan

## Análisis del Sistema

### 1. Cómo funciona el compilador (`@workflow/cli`)
El builder (`packages/cli/src/lib/builders/base-builder.ts`) ejecuta un proceso en dos fases:
- **Discovery**: escanea archivos de entrada (`dirs` y `includeModules`) buscando funciones con `'use workflow'` y `'use step'` mediante esbuild + plugin SWC.
- **Bundling**: genera dos bundles separados:
  - **Steps bundle**: empaqueta todos los steps con `mode: 'step'` (el plugin SWC convierte cada step en un stub que llama al runtime).
  - **Workflows bundle**: empaqueta los workflows con `mode: 'workflow'` (el plugin SWC convierte cada workflow en un stub que previene ejecución directa y asigna `workflowId`).
- **Output**: genera `app/.well-known/workflow/v1/flow/route.js` que contiene un string `workflowCode` con todo el bundle en CJS, y lo pasa a `workflowEntrypoint()`.

El plugin SWC (`packages/swc-plugin-workflow`) inyecta:
- Para `'use workflow'`: reemplaza el cuerpo de la función por un `throw new Error(...)` y añade `.workflowId = "workflow//filepath//functionName"`.
- Para `'use step'`: reemplaza el cuerpo por `return globalThis[Symbol.for("WORKFLOW_USE_STEP")]("stepId")(args)`.
- Emite metadata en comentario `/**__internal_workflows{...}*/`.
- **IMPORTANTE**: el `workflowId` se genera usando el `filename` pasado al transform de SWC.

El proceso de bundling (líneas 379-386 de `base-builder.ts`):
```javascript
const imports =
  `globalThis.__private_workflows = new Map();\n` +
  workflowFiles
    .map((file, workflowFileIdx) => {
      return `import * as workflowFile${workflowFileIdx} from ${JSON.stringify(file)};
        Object.values(workflowFile${workflowFileIdx}).map(item => item?.workflowId && globalThis.__private_workflows.set(item.workflowId, item))`;
    })
    .join('\n');
```
Este código importa CADA archivo descubierto, toma sus exports y registra en `__private_workflows` los que tengan `workflowId`.

### 2. Cómo funciona el runtime (`packages/core`)
`workflowEntrypoint` (línea 270 de `packages/core/src/runtime.ts`) recibe el string compilado (`workflowCode`) y crea un handler de cola que:
1. Parsea el mensaje de invocación (`runId`, `workflowName`).
2. Llama a `runWorkflow(workflowCode, workflowRun, events)` (línea 339).
3. `runWorkflow` ejecuta el `workflowCode` dentro de un contexto aislado (VM) con `node:vm`.
4. Antes de ejecutar, inyecta símbolos (`WORKFLOW_USE_STEP`, `WORKFLOW_CREATE_HOOK`) en el `globalThis` del VM.
5. El bundle dentro del VM registra workflows en `globalThis.__private_workflows`.
6. Cuando se llama `start(workflowFn, args)`, lee `.workflowId` del stub (línea 54 de `runtime/start.ts`) y crea el mensaje en la cola.
7. El handler ejecuta el bundle y busca la función: `globalThis.__private_workflows.get(workflowName)` (línea 535 de `workflow.ts`).
8. Si el `workflowId` en el stub NO coincide exactamente con alguna clave en el mapa, devuelve `undefined` y lanza `ReferenceError`.

### 3. Compilación con librerías vs carpetas locales

#### Carpetas locales (workflows dentro del proyecto)
- El builder escanea `dirs: ['pages', 'app', 'src/pages', 'src/app']` y detecta archivos TS/JS con directives.
- Aplica SWC transform sobre archivos `src/**/*.ts` usando rutas normalizadas (forward slashes).
- Genera el bundle incluyendo DIRECTAMENTE los archivos transformados.
- El virtual-entry importa cada archivo: `import * as workflowFile0 from './workflows/X.ts'`.
- Registra en `__private_workflows`: `Object.values(workflowFile0).map(...)`.
- Resultado: la función exportada llega al runtime con `.workflowId` correctamente asignado Y está registrada en el mapa.

#### Librerías externas (workflows en `node_modules` o workspace)
- **Con `workflows.libraries`**: el builder resuelve la librería vía `require.resolve(identifier)` y escanea su directorio.
- **Con `workflows.directories`**: el builder trata la ruta como directorio local y escanea directamente.
- En AMBOS casos, el builder detecta archivos con directives y los incluye en el bundle del flow route.
- El loader de Next.js (`packages/next/src/loader.ts`) TAMBIÉN transforma esos archivos cuando la API los importa (con `mode: 'client'`).

**Diferencia clave que causaba el bug:**
- **Builder** (en `apply-swc-transform.ts`): recibía `filename` con formato de la plataforma (Windows: `C:\Users\...` o Unix: `/Users/...`) y lo pasaba tal cual a SWC → generaba `workflowId` con backslashes en Windows.
- **Loader de Next** (en `packages/next/src/loader.ts`): recibía `this.resourcePath` con backslashes de Windows y lo pasaba tal cual a SWC → generaba `workflowId` con backslashes.
- **PERO**: cuando el builder importaba archivos usando esbuild/virtual-entry, las rutas internas de esbuild usaban forward slashes → `workflowId` inconsistente.

### 4. El Bug Explicado (CAUSA RAÍZ FINAL)

**Problema de normalización de rutas:**
1. Builder escanea `workbench/workflow-npm-library/src/workflows/workbench-library.ts`.
2. En el proceso de bundling con esbuild, el `filename` llega normalizado con forward slashes: `C:/Users/.../workbench-library.ts`.
3. El builder aplica SWC transform con ese filename → genera `workflowId = "workflow//C:/Users/.../workbench-library.ts//runWorkbenchLibraryWorkflow"`.
4. Registra en `__private_workflows` con esa clave (forward slashes).
5. Cuando la API importa la librería, Next.js llama al loader con `this.resourcePath = "C:\\Users\\...\\workbench-library.ts"` (backslashes).
6. El loader aplicaba SWC transform con ese filename sin normalizar → generaba `workflowId = "workflow//C:\\Users\\...\\workbench-library.ts//runWorkbenchLibraryWorkflow"` (backslashes).
7. `start()` lee ese `workflowId` con backslashes y lo envía a la cola.
8. El runtime busca en `__private_workflows.get("workflow//C:\\Users\\...")` → NO existe (solo existe la versión con forward slashes) → devuelve `undefined` → `ReferenceError`.

### 5. Solución Implementada

**Normalizar rutas en AMBOS lugares:**
1. **En el loader** (`packages/next/src/loader.ts`): normalizar `this.resourcePath` antes de pasarlo a SWC:
   ```typescript
   const normalizedFilename = normalizePath(filename);
   const result = await transform(normalizedSource, {
     filename: normalizedFilename,
     // ...
   });
   ```

2. **En el builder** (`packages/cli/src/lib/builders/apply-swc-transform.ts`): normalizar el `filename` recibido:
   ```typescript
   const normalizedFilename = filename.replace(/\\/g, '/');
   const result = await transform(source, {
     filename: normalizedFilename,
     // ...
   });
   ```

Esto garantiza que TODOS los `workflowId` generados usen forward slashes, independientemente de la plataforma, y el `Map.get()` funciona correctamente.

## Steps
1. Modificar el loader de `workflow/next` ✓
2. Crear y enlazar el workbench de prueba ✓
3. Diagnóstico completo ✓
4. Normalizar rutas en loader y builder ✓
5. Reejecutar tests y validar ✓

## Execution
1. Step 1 – Modificar loader (aplicado previamente)
   `packages/next/src/index.ts` y `loader.ts` actualizados para soportar `workflows.libraries`.
2. Step 2 – Crear workbench
   - Creado `workbench/workflow-npm-library` con `src/workflows/workbench-library.ts` y `src/steps/uppercase.ts`.
   - Configurado `package.json` para exportar desde `src/`.
   - Creado endpoint `/api/library-test` y prueba Playwright en `nextjs-turbopack`.
   - Registrado en `pnpm-workspace.yaml`.
3. Step 3 – Diagnóstico
   - Ejecutado `pnpm --filter nextjs-turbopack run test:e2e` → falló con `ReferenceError`.
   - Analizados bundles generados: confirmado que builder Y loader transforman archivos, pero con rutas inconsistentes (forward slashes vs backslashes).
   - Identificada causa raíz: diferencia en normalización de rutas entre builder (usa forward slashes internamente) y loader (recibe backslashes de Windows).
4. Step 4 – Aplicar fix de normalización
   - Modificado `packages/cli/src/lib/builders/apply-swc-transform.ts` línea 37: añadida normalización `filename.replace(/\\/g, '/')`.
   - Modificado `packages/next/src/loader.ts` línea 96: normalizar `filename` antes de pasar a SWC.
   - Recompilado `@workflow/cli` y `@workflow/next`: `pnpm --filter @workflow/cli run build && pnpm --filter @workflow/next run build`.
   - Limpiado artefactos: `Remove-Item -Recurse -Force workbench/nextjs-turbopack/.next, .swc, app/.well-known/workflow`.
5. Step 5 – Test final
   - Ejecutado `pnpm --filter nextjs-turbopack run test:e2e`.
   - **RESULTADO: ✓ PASSED**
   - Salida: `POST /api/library-test 200 in 9279ms` → `ok 1 [chromium] › ... ejecuta el workflow de la librería y devuelve el resultado esperado (9.4s)` → `1 passed (45.1s)`.
   - El workflow ejecutó correctamente, el step `uppercaseStep` procesó el input y devolvió `{ ok: true, workflow: 'library:workbench', echo: 'library-test', upper: 'LIBRARY-TEST', processedAt: ... }`.

## Result

✅ **ÉXITO**: `workflow/next` ahora soporta librerías externas correctamente.

**Cambios realizados:**
1. `packages/next/src/index.ts`: añadido soporte para `workflows.libraries` con resolución y escaneo de directorios de librerías.
2. `packages/next/src/loader.ts`: normalización de rutas antes del transform SWC.
3. `packages/cli/src/lib/builders/apply-swc-transform.ts`: normalización de rutas para consistencia cross-platform.
4. `workbench/workflow-npm-library`: librería de prueba que exporta workflows/steps desde `src/`.
5. `workbench/nextjs-turbopack`: workbench configurado con `workflows.directories` apuntando a la librería.
6. Playwright test validando el flujo end-to-end.

**Lección clave**: el `workflowId` debe ser idéntico entre:
- El stub generado por el loader (cuando la API importa el workflow).
- La función registrada en `__private_workflows` (cuando el builder empaqueta el flow route).

La inconsistencia de rutas Windows (backslashes) vs Unix (forward slashes) rompía esa igualdad, causando que `Map.get()` fallara. La solución fue normalizar TODAS las rutas a forward slashes antes de pasarlas al plugin SWC.
