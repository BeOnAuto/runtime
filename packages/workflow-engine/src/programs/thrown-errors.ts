import { Schema } from 'effect';

import type { ProgramFailure } from './program-run.ts';

export type Raised = 'raised' | 'unfit';

interface Described {
  readonly text: string;
  readonly stack: string;
}

export const programFile = 'program.ts';

export const expressionFile = 'expression.ts';

const expressionPrefixLines = 2;

const unreadable: Described = { text: 'an error that could not be read', stack: '' };

const placeInFile = /(program|expression)\.ts:(\d+)/u;

const thrownTypeError = /^TypeError: /u;

const describedIn = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ text: Schema.String, stack: Schema.String })),
);

function lineIn({ stack }: Described): number | null {
  const found = placeInFile.exec(stack);
  if (found === null) {
    return null;
  }
  const [, file, line] = found;
  return Math.max(1, Number(line) - (file === 'expression' ? expressionPrefixLines : 0));
}

export function failedBy(raised: Raised, description: string | undefined, work: number): ProgramFailure {
  const described = description === undefined ? unreadable : describedIn(description);
  return raised === 'raised'
    ? { ran: 'raised', issue: { detail: described.text, line: lineIn(described) }, work }
    : { ran: 'unfit', issue: { detail: described.text.replace(thrownTypeError, ''), line: null }, work };
}
