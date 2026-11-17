import { Predicate } from 'effect';

import { isAGuardedKeptFile, refusedAsText } from './kept-files.ts';

const objectText = '[object Object]';

export function isTextToWrite(value: unknown): boolean {
  return !Predicate.isObjectOrArray(value);
}

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
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return isAGuardedKeptFile(value) ? refusedAsText() : objectText;
}
