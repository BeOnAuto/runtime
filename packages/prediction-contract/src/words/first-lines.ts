export function firstLineOf(error: unknown): string {
  const [line = ''] = (error instanceof Error ? error.message : String(error)).split('\n');
  return line.trim();
}
