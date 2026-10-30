const objectText = '[object Object]';

export function outputText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => outputText(item)).join('');
  }
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : objectText;
}
