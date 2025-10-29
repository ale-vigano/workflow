# PR: Soporte de Librerías Externas en workflow/next + Fix Cross-Platform

Este PR introduce soporte para librerías externas con workflows/steps en `workflow/next` y corrige un bug crítico de normalización de rutas en Windows.

---

## Parte 1: Soporte de Librerías Externas en `workflow/next`

### Objetivo
Permitir que proyectos Next.js puedan importar workflows y steps desde librerías npm externas (workspace packages o node_modules), no solo desde carpetas locales del proyecto.

### Cambios Implementados

#### 1. `packages/next/src/index.ts` - Nueva configuración `workflows.libraries` y `workflows.directories`

**Funcionalidad agregada:**
- Nuevas opciones en `withWorkflow()`:
  - `workflows.directories`: array de rutas relativas a directorios adicionales con workflows/steps.
  - `workflows.libraries`: array de identificadores de paquetes npm (ej: `'@my-org/workflows'`).

**Implementación:**
- `scanWorkflowDirectiveFiles(rootDir)`: función que escanea recursivamente un directorio buscando archivos `.ts/.tsx/.js/.jsx` que contengan las directivas `'use workflow'` o `'use step'`.
- `resolveLibraryIncludes(identifier)`: resuelve un identificador de librería usando `require.resolve()`, localiza su `package.json` y escanea su directorio completo.
- Genera:
  - `loaderIncludePaths`: rutas que se pasan al loader de Next.js vía `WORKFLOW_LOADER_INCLUDE` para limitar la transformación solo a archivos relevantes.
  - `builderIncludeModules`: lista de archivos/globs que se pasan al builder como `includeModules` para que los empaquete en el flow route.

**Código clave:**
```typescript
const { files: includeFiles, dirs: includeDirs } = resolveLibraryIncludes(identifier)
// ... recolecta archivos y directorios de la librería

process.env.WORKFLOW_LOADER_INCLUDE = JSON.stringify(loaderIncludePaths);

const workflowBuilder = new NextBuilder({
  dirs: ['pages', 'app', 'src/pages', 'src/app', ...resolvedAdditionalDirs],
  includeModules: [...builderIncludeModules],
  // ...
});
```

#### 2. `packages/next/src/loader.ts` - Filtrado de transformación basado en `WORKFLOW_LOADER_INCLUDE`

**Funcionalidad agregada:**
- Lee la variable de entorno `WORKFLOW_LOADER_INCLUDE` (seteada por `index.ts`).
- Implementa `isPathIncluded(filename)`: verifica si un archivo debe ser transformado comparando su ruta con las rutas incluidas.
- Solo aplica el transform de SWC a archivos que:
  1. Estén en las rutas incluidas (o si no hay filtro, todos).
  2. Contengan las directivas `'use workflow'` o `'use step'`.

**Beneficio:**
Evita transformar innecesariamente TODO el código de `node_modules`, mejorando performance y evitando conflictos.

#### 3. `packages/cli/src/lib/config/types.ts` - Nueva opción `includeModules`

Agregado campo `includeModules?: string[]` al tipo `WorkflowConfig` para que el builder pueda recibir módulos adicionales desde el plugin de Next.js.

#### 4. `packages/cli/src/lib/builders/base-builder.ts` - Procesamiento de `includeModules`

**Cambios:**
- `getInputFiles()` ahora incluye archivos de `config.includeModules` en la lista de entradas.
- `createStepsBundle()` y `createWorkflowsBundle()` consideran `includeModules` al determinar qué archivos empaquetar.
- Normalización de rutas usando `toNormalizedPath()` para consistencia.
- Uso de `JSON.stringify()` en imports del virtual-entry para manejar correctamente rutas con espacios o caracteres especiales.

#### 5. `packages/cli/src/lib/builders/swc-esbuild-plugin.ts` - Skip de transform para archivos en `/dist/`

**Lógica agregada:**
```typescript
if (
  normalizedLower.includes('/dist/') &&
  !normalizedLower.includes('/src/')
) {
  // Cargar sin transformar - ya está compilado
  return { contents: source, loader: 'js' }
}
```

Esto evita aplicar el transform de SWC a archivos ya compilados (CommonJS en `dist/`), asegurando que solo los archivos fuente (`src/`) sean procesados.

### Configuración de Uso

```typescript
// next.config.ts
export default withWorkflow({
  transpilePackages: ['@my-workflows'],
  workflows: {
    directories: ['../my-local-workflows/src'],  // Rutas relativas
    libraries: ['@my-workflows'],                 // Paquetes npm
  },
});
```

---

## Parte 2: Fix Cross-Platform - Normalización de Rutas Windows/Unix

### Problema
En Windows, las rutas usan backslashes (`C:\Users\...`), mientras que en Unix usan forward slashes (`/Users/...`). El plugin SWC genera `workflowId` usando el `filename` recibido, lo que causaba:

- Builder (esbuild interno): `workflowId = "workflow//C:/Users/.../workflow.ts//myWorkflow"`
- Loader de Next.js: `workflowId = "workflow//C:\Users\...\workflow.ts\myWorkflow"`

Cuando el runtime buscaba `__private_workflows.get(workflowId)`, las claves no coincidían → `undefined` → `ReferenceError`.

### Solución

Normalizar TODAS las rutas a forward slashes en los puntos de entrada al plugin SWC:

#### 1. `packages/cli/src/lib/builders/swc-esbuild-plugin.ts` (línea 123)

```typescript
build.onLoad({ filter: jsTsRegex }, async (args) => {
  const normalizedPath = args.path.replace(/\\/g, '/');  // <-- normaliza antes de pasar a applySwcTransform
  
  const { code: transformedCode } = await applySwcTransform(
    normalizedPath,  // <-- usa la versión normalizada
    source,
    options.mode,
    // ...
  );
});
```

#### 2. `packages/next/src/loader.ts`

```typescript
export default async function workflowLoader(...) {
  // Normalize filename to use forward slashes for consistent workflowId generation
  const normalizedFilename = normalizePath(filename);

  const result = await transform(normalizedSource, {
    filename: normalizedFilename,  // <-- usa la versión normalizada
    // ...
  });
}
```

La función `normalizePath()` también normaliza el drive letter (`C:` → `C:/`).

### Impacto

✅ Los `workflowId` ahora son consistentes entre Windows y Unix.  
✅ El `Map.get()` en `__private_workflows` funciona correctamente.  
✅ Workflows en librerías externas se ejecutan sin errores.

---

## Testing

### Workbench de Prueba Creado

- `workbench/workflow-npm-library/`: librería de ejemplo que exporta:
  - `uppercaseStep`: step que convierte texto a mayúsculas.
  - `runWorkbenchLibraryWorkflow`: workflow que usa el step.
- `workbench/nextjs-turbopack/`: aplicación Next.js configurada para importar la librería.
  - Endpoint `/api/library-test` que ejecuta el workflow de la librería.
  - Test Playwright que valida el flujo end-to-end.

### Resultado del Test

```bash
pnpm --filter nextjs-turbopack run test:e2e

✓ POST /api/library-test 200 in 9279ms
✓ ok 1 [chromium] › ejecuta el workflow de la librería (9.4s)
  1 passed (45.1s)
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

## Archivos Modificados

### Core Changes (para merge)
- `packages/next/src/index.ts` - soporte de libraries/directories
- `packages/next/src/loader.ts` - filtrado + normalización
- `packages/cli/src/lib/config/types.ts` - tipo `includeModules`
- `packages/cli/src/lib/builders/base-builder.ts` - procesamiento de includeModules
- `packages/cli/src/lib/builders/swc-esbuild-plugin.ts` - skip de dist/ + normalización
- `packages/cli/src/lib/builders/apply-swc-transform.ts` - normalización de rutas

### Workbench/Testing (no para merge, solo demostración)
- `workbench/workflow-npm-library/` - librería de prueba
- `workbench/nextjs-turbopack/next.config.ts` - configuración de ejemplo
- `workbench/nextjs-turbopack/app/api/library-test/route.ts` - endpoint de prueba
- `workbench/nextjs-turbopack/playwright/library-workflow.spec.ts` - test e2e
- `workbench/nextjs-turbopack/playwright.config.ts` - configuración de Playwright
- `pnpm-workspace.yaml` - registro de la librería de prueba

---

## Notas de Implementación

1. **Compatibilidad**: los cambios son backwards-compatible. Proyectos sin `workflows.libraries` o `workflows.directories` siguen funcionando igual.

2. **Performance**: el filtrado con `WORKFLOW_LOADER_INCLUDE` asegura que solo se transformen archivos relevantes, no todo `node_modules`.

3. **Limitación conocida**: las librerías deben exportar desde `src/` (archivos TypeScript) para que el loader pueda transformarlos. Si exportan solo desde `dist/` (CommonJS pre-compilado), los workflows no funcionarán (por el skip en línea 125-136 del plugin).

4. **Alternativa robusta**: usar `workflows.directories` apuntando a la carpeta `src/` de la librería en lugar de `workflows.libraries`. Esto evita la resolución de `require.resolve()` y trata la librería como código local.

---

## Documentación Generada

Ver `.cursor/.plan/library.md` para análisis completo del sistema:
- Cómo funciona el compilador (builder + plugin SWC)
- Cómo funciona el runtime (VM + `__private_workflows`)
- Diferencias entre carpetas locales vs librerías
- Explicación detallada del bug y la solución

