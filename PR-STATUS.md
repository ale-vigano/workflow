# Estado del PR: Soporte de Librerías Externas en workflow/next

## Objetivo
Hacer que `workflow/next` funcione correctamente con librerías externas que contienen workflows y steps usando `workflows.libraries`.

## Estado Actual
❌ **NO FUNCIONA** - El test e2e falla con el error:
```
ReferenceError: Workflow "workflow//C:/Users/aleja/storias/projects/vercel-workflow/workflow/workbench/workflow-npm-library/src/workflows/workbench-library.ts//runWorkbenchLibraryWorkflow" must be a function, but got "undefined" instead
```

## Problema Identificado
El problema fundamental es una inconsistencia en la generación del `workflowId`:

1. **Builder**: Procesa archivos de `src/` y genera `workflowId` con path de `src/`
2. **Runtime**: Busca workflows usando el `workflowId` del workflow importado
3. **Mismatch**: El `workflowId` generado en el builder no coincide con el contexto del runtime

## Configuración Actual (Funcional pero con redundancia)
```typescript
// next.config.ts
const nextConfig: NextConfig = {
  serverExternalPackages: ['@node-rs/xxhash'],
  transpilePackages: ['@worklow-npm-library'], // ← REQUERIDO
  workflows: {
    libraries: ['@worklow-npm-library'], // ← REDUNDANTE
  },
};
```

## Cambios Realizados

### ✅ Cross-Platform Compatibility (FUNCIONA)
- **`packages/cli/src/lib/builders/apply-swc-transform.ts`**: Normalización de paths a forward slashes
- **`packages/next/src/loader.ts`**: Normalización de paths en el loader de Next.js
- **`packages/cli/src/lib/builders/base-builder.ts`**: Normalización en BaseBuilder
- **`packages/cli/src/lib/builders/swc-esbuild-plugin.ts`**: Normalización en el plugin de esbuild

### ❌ Library Compatibility (NO FUNCIONA)
- **`packages/next/src/index.ts`**: Intentos de automatizar `transpilePackages` (revertidos)
- **`packages/next/src/loader.ts`**: Intentos de mapeo de paths de librerías (revertidos)

## Workbench Configurado
- ✅ `@worklow-npm-library`: Librería de prueba creada
- ✅ `nextjs-turbopack`: Workbench configurado con `workflows.libraries`
- ✅ `/api/library-test`: Endpoint de prueba creado
- ✅ `playwright/library-workflow.spec.ts`: Test e2e creado
- ❌ **Test falla**: Error de `workflowId` no encontrado

## Próximos Pasos Recomendados

### Opción 1: Documentar la Limitación Actual
- Documentar que `transpilePackages` es requerido para `workflows.libraries`
- Mantener la configuración actual que funciona
- Crear documentación clara sobre el uso de librerías externas

### Opción 2: Investigación Profunda
- Investigar cómo hacer que el `workflowId` sea consistente entre builder y runtime
- Posiblemente modificar el SWC plugin para generar `workflowId` más robustos
- O modificar el runtime para manejar múltiples formatos de `workflowId`

## Archivos del PR
- `workbench/workflow-npm-library/`: Librería de prueba
- `workbench/nextjs-turbopack/`: Workbench configurado
- `packages/next/src/loader.ts`: Normalización de paths
- `packages/cli/src/lib/builders/`: Normalización en builders
- `packages/swc-plugin-workflow/`: Plugin SWC (sin cambios)

## Conclusión
El PR resuelve completamente el problema de **Cross-Platform Compatibility** pero no resuelve el problema de **Library Compatibility**. La configuración actual funciona pero requiere `transpilePackages` manual, lo cual es redundante con `workflows.libraries`.
