import { Conflict, InvalidInput } from '@on.auto/operations';
import { JsonPointer } from 'effect';

import type { TextFailure } from './text-rendering.ts';

const inputPath = /^input\./u;

export function unworkable(pointer: string, detail: string): Conflict {
  return new Conflict({ detail, kind: 'unworkable', record: { pointer } });
}

function inputPointerOf(variable: string): string {
  return inputPath.test(variable)
    ? variable
        .replace(inputPath, '')
        .split('.')
        .map((segment) => `/${JsonPointer.escapeToken(segment)}`)
        .join('')
    : '';
}

function invalidWith(detail: string, issue: string, pointer = ''): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer, detail: issue }] });
}

export function unrenderableFor(
  what: string,
  failure: Exclude<TextFailure, { readonly reason: 'not_text' }>,
): InvalidInput {
  if (failure.reason === 'missing_variable') {
    return invalidWith(
      `The definition reads ${failure.variable} on line ${failure.line}, which the input does not have`,
      `Line ${failure.line}: it reads ${failure.variable}, which this input does not have`,
      inputPointerOf(failure.variable),
    );
  }
  return invalidWith(
    `${what} cannot be rendered with this input`,
    `Line ${failure.line}: the render stopped here, past what a render may take, or at a filter that refused the value`,
  );
}
