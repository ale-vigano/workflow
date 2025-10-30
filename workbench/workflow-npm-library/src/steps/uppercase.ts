export async function uppercaseStep(value: string) {
  'use step';

  // Transformación verificable: agregar prefijo y convertir a mayúsculas
  const transformedValue = `[STEP-PROCESSED] ${value.toUpperCase()}`;

  return {
    input: value,
    upper: transformedValue,
    processedAt: Date.now(),
  };
}
