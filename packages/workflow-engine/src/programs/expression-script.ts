export function expressionScript(body: string, names: readonly string[]): string {
  return `'use strict';\n((${names.join(', ')}) => (\n${body}\n))`;
}
