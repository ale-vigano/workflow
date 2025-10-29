# PR: Soporte de Librerías Externas en workflow/next + Fix Cross-Platform

## Resumen

Este PR añade soporte para workflows/steps en librerías externas y corrige un bug crítico de normalización de rutas en Windows.

**Test e2e:** ✅ Pasando (1 passed in 17.8s)

---

## Parte 1: Fix Cross-Platform - Normalización de Rutas

### Problema
En Windows, el `workflowId` generado por el loader de Next.js usaba backslashes (`C:\Users\...`), mientras que el builder usaba forward slashes (`C:/Users/...`). Esto causaba que `__private_workflows.get(workflowId)` fallara al buscar la función → `ReferenceError: must be a function, but got "undefined"`.

### Solución
Normalizar las rutas a forward slashes antes de pasarlas al plugin SWC.

#### Archivos modificados:

**1. `packages/cli/src/lib/builders/swc-esbuild-plugin.ts`**
```diff
+ const normalizedPath = args.path.replace(/\\/g, '/');
  const { code: transformedCode } = await applySwcTransform(
-   args.path,
+   normalizedPath,
    source,
    options.mode,
```

**2. `packages/next/src/loader.ts`**
```diff
+ const normalizedFilename = normalizePath(filename);
  const result = await transform(normalizedSource, {
-   filename,
+   filename: normalizedFilename,
```

Además añade la función `normalizePath()` y lógica de filtrado basada en `WORKFLOW_LOADER_INCLUDE`.

---

## Parte 2: Soporte de Librerías Externas

### Objetivo
Permitir que proyectos Next.js importen workflows/steps desde librerías npm externas.

### Nueva API

```typescript
// next.config.ts
export default withWorkflow({
  transpilePackages: ['@my-workflows'],
  workflows: {
    directories: ['../custom-workflows/src'],  // Rutas relativas
    libraries: ['@my-workflows'],              // Paquetes npm
  },
});
```

### Archivos modificados:

**1. `packages/next/src/index.ts`** - Nueva configuración y resolución de librerías

Añade:
- `scanWorkflowDirectiveFiles()`: escanea directorios buscando archivos con directives
- `resolveLibraryIncludes()`: resuelve librerías npm y encuentra sus workflows/steps
- Soporte para `workflows.directories` y `workflows.libraries`
- Setea `WORKFLOW_LOADER_INCLUDE` para que el loader sepa qué archivos transformar
- Pasa `includeModules` al builder para que empaquete archivos de librerías

**2. `packages/cli/src/lib/config/types.ts`** - Nuevo campo

```diff
+ includeModules?: string[];
```

**3. `packages/cli/src/lib/builders/base-builder.ts`** - Procesamiento de `includeModules`

```diff
+ const toNormalizedPath = (value: string) => normalize(value).replace(/\\/g, '/');

  protected async getInputFiles(): Promise<string[]> {
    const result = await glob(...);
-   return result;
+   const normalized = result.map(toNormalizedPath);
+   
+   if (this.config.includeModules && this.config.includeModules.length > 0) {
+     for (const modulePath of this.config.includeModules) {
+       const normalizedModule = toNormalizedPath(modulePath);
+       if (!normalized.includes(normalizedModule)) {
+         normalized.push(normalizedModule);
+       }
+     }
+   }
+   return normalized;
  }
```

También añade `includeModules` a `entriesToBundle` del step bundle (línea 314).

**4. `packages/cli/src/lib/builders/swc-esbuild-plugin.ts`** - Skip de archivos `/dist/`

```diff
+ const normalizedPath = args.path.replace(/\\/g, '/');
+ const normalizedLower = normalizedPath.toLowerCase();
+ if (
+   normalizedLower.includes('/dist/') &&
+   !normalizedLower.includes('/src/')
+ ) {
+   // Cargar sin transformar - ya está compilado
+   return { contents: source, loader: 'js' }
+ }
```

Esto evita re-transformar archivos CommonJS ya compilados en `dist/`.

**5. Cambios menores de formato/imports** en:
- `packages/cli/src/lib/builders/discover-entries-esbuild-plugin.ts`
- `packages/cli/src/lib/builders/next-build.ts`

---

## Workbench de Prueba (no para merge al PR principal)

Archivos creados para demostrar y testear la funcionalidad:

```
workbench/workflow-npm-library/          # Librería de ejemplo
├── src/
│   ├── index.ts                         # Exporta Steps y Workflows
│   ├── steps/
│   │   ├── index.ts
│   │   └── uppercase.ts                 # Step con 'use step'
│   └── workflows/
│       ├── index.ts
│       └── workbench-library.ts         # Workflow con 'use workflow'
└── package.json                         # Exporta desde src/

workbench/nextjs-turbopack/
├── next.config.ts                       # Configurado con workflows.directories
├── package.json                         # Añade @worklow-npm-library + Playwright
├── app/api/library-test/route.ts        # Endpoint que ejecuta el workflow
├── playwright.config.ts                 # Config de Playwright
└── playwright/library-workflow.spec.ts  # Test e2e
```

---

## Testing

### Prueba desde cero (clean build):

```bash
# 1. Compilar paquetes modificados
pnpm --filter @workflow/cli run build
pnpm --filter @workflow/next run build

# 2. Ejecutar test e2e
pnpm --filter nextjs-turbopack run test:e2e
```

### Resultado:
```
✓ POST /api/library-test 200 in 3533ms
✓ ok 1 [chromium] › ejecuta el workflow de la librería (3.6s)
  1 passed (17.8s)
```

**Respuesta de la API:**
```json
{
  "success": true,
  "runId": "wrun_...",
  "result": {
    "ok": true,
    "workflow": "library:workbench",
    "echo": "library-test",
    "upper": "LIBRARY-TEST",
    "processedAt": 1730044844000
  }
}
```

---

## Archivos Core para el PR

### Modificados (para merge):
- `packages/next/src/index.ts` - soporte libraries/directories
- `packages/next/src/loader.ts` - filtrado + normalización
- `packages/cli/src/lib/config/types.ts` - tipo `includeModules`
- `packages/cli/src/lib/builders/base-builder.ts` - procesamiento includeModules + normalización
- `packages/cli/src/lib/builders/swc-esbuild-plugin.ts` - skip dist/ + normalización
- `packages/cli/src/lib/builders/discover-entries-esbuild-plugin.ts` - ajustes menores
- `packages/cli/src/lib/builders/next-build.ts` - ajustes menores

### Workbench (solo para testing, opcional en PR):
- `workbench/workflow-npm-library/*` - librería de prueba
- `workbench/nextjs-turbopack/next.config.ts` - ejemplo de configuración
- `workbench/nextjs-turbopack/package.json` - dependencias de test
- `workbench/nextjs-turbopack/app/api/library-test/route.ts` - endpoint de prueba
- `workbench/nextjs-turbopack/playwright.config.ts` - config Playwright
- `workbench/nextjs-turbopack/playwright/library-workflow.spec.ts` - test e2e

---

## Validación Final

✅ Compilación limpia de `@workflow/cli` y `@workflow/next`  
✅ Test e2e pasando con librería externa importada  
✅ Workflow ejecutado correctamente con step desde la librería  
✅ Compatible con Windows (rutas normalizadas)  
✅ Backwards compatible (proyectos sin `workflows.libraries` siguen funcionando)

---

## Notas de Implementación

1. **Librerías deben exportar desde `src/`**: el loader de Next.js necesita archivos TypeScript para transformarlos. Si la librería solo exporta `dist/` CommonJS, no funcionará (el plugin skip archivos en `/dist/`).

2. **Alternativa robusta**: usar `workflows.directories` apuntando a `../my-lib/src` en lugar de `workflows.libraries: ['my-lib']`. Ambos funcionan, pero `directories` es más explícito.

3. **Performance**: el filtrado con `WORKFLOW_LOADER_INCLUDE` asegura que solo se transformen archivos relevantes, no todo `node_modules`.

