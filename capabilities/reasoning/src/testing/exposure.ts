import { inspect } from 'node:util';

export function exposedText(value: unknown): string {
  return [JSON.stringify(value), String(value), inspect(value, { depth: 8, showHidden: true })].join('\n');
}
