import { Conflict } from '@on.auto/operations';
import type { Payload } from '@on.auto/operations/payloads';

import { blankPlacesIn } from '../portable/blanks.ts';

export type BlankedChange = 'create' | 'update' | 'resume';

const whenToWriteIt: Readonly<Record<BlankedChange, string>> = {
  create: 'before you create it',
  update: 'before you save it, because an active definition cannot keep a blank',
  resume: 'with update_definition before you resume it',
};

function moreBlanks(count: number): string {
  if (count === 0) {
    return '';
  }
  return count === 1 ? ', and one more blank' : `, and ${count} more blanks`;
}

export function blankRefusalOf(source: string, change: BlankedChange): Conflict | undefined {
  const [first, ...rest] = blankPlacesIn(source);
  if (first === undefined) {
    return undefined;
  }
  const others = new Set(rest.map(({ name }) => name).filter((name) => name !== first.name));
  return new Conflict({
    detail: `Ask the person: What is the value of the blank ${first.name}? The source still holds it on line ${first.line}${moreBlanks(others.size)}; write the value in its place ${whenToWriteIt[change]}`,
  });
}

interface SourceAsRecorded {
  readonly source?: string | Payload<string>;
}

function inlineSourceOf({ source }: SourceAsRecorded): string | undefined {
  if (source === undefined || typeof source === 'string') {
    return source;
  }
  return 'inline' in source ? source.inline : undefined;
}

export function blankRefusalWhere(
  refused: boolean | undefined,
  recorded: SourceAsRecorded,
  change: BlankedChange,
): Conflict | undefined {
  const source = inlineSourceOf(recorded);
  return refused === true && source !== undefined ? blankRefusalOf(source, change) : undefined;
}
