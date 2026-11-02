export const memoryInput = [
  'input:',
  '  schema:',
  '    type: object',
  '    required: [fact]',
  '    properties: { fact: { type: string }, about: { type: string }, replaces: { type: string } }',
];

export function memoryDocument(lines: readonly string[], body = ''): string {
  return ['---', ...lines, '---', body].join('\n');
}

function blockOf(name: string, lines: readonly string[]): readonly string[] {
  return lines.length === 0 ? [`${name}: {}`] : [`${name}:`, ...lines.map((line) => `  ${line}`)];
}

export function rememberDocument(remember: readonly string[] = [], input: readonly string[] = memoryInput): string {
  return memoryDocument([
    'description: Keeps what the team decided',
    ...input,
    ...blockOf('remember', ["text: '{{ input.fact }}'", ...remember]),
  ]);
}

export function recallDocument(recall: readonly string[] = [], input: readonly string[] = memoryInput): string {
  return memoryDocument(['description: Recalls what the team decided', ...input, ...blockOf('recall', recall)]);
}
