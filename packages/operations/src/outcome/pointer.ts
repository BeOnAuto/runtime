import { JsonPointer } from 'effect';

export function pointerOf(path: readonly PropertyKey[]): string {
  return path.map((key) => `/${JsonPointer.escapeToken(String(key))}`).join('');
}
