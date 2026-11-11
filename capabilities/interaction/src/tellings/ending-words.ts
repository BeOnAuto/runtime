import { parsedTemplate } from '@on.auto/definitions/template';
import { toolBlockEngine } from '@on.auto/definitions/tool-blocks';
import { Function, Result, Schema } from 'effect';

import type { TellingRoute } from './telling-routes.ts';

const AnsweredInAutoSchema = Schema.Struct({
  fact: Schema.String,
  kind: Schema.Literal('answered'),
  by: Schema.String,
  words: Schema.Array(Schema.String),
});

export const UnansweredKindSchema = Schema.Literals(['expired', 'cancelled']);

const UnansweredSchema = Schema.Struct({ fact: Schema.String, kind: UnansweredKindSchema });

export const EndingSchema = Schema.Union([AnsweredInAutoSchema, UnansweredSchema]);

export type Ending = typeof EndingSchema.Type;

type Unanswered = typeof UnansweredSchema.Type;

const listed = new Intl.ListFormat('en-GB', { type: 'conjunction' });

const unansweredWords: Readonly<Record<Unanswered['kind'], string>> = {
  expired: 'Expired unanswered.',
  cancelled: 'Cancelled unanswered.',
};

export function endingWords(ending: Ending): string {
  if (ending.kind !== 'answered') {
    return unansweredWords[ending.kind];
  }
  const { by, words } = ending;
  return words.length === 0 ? `Answered in Auto by ${by}.` : `Answered in Auto by ${by}: ${listed.format(words)}.`;
}

const twoFigures = '2-digit';

const sentOn = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: twoFigures,
  minute: twoFigures,
  hourCycle: 'h23',
  timeZone: 'UTC',
});

export function namingTheRequest(sentAt: number, words: string): string {
  return `The request sent ${sentOn.format(sentAt)} UTC: ${words}`;
}

function readsTheRequestsMessage(value: Schema.Json): boolean {
  if (typeof value === 'string') {
    const parsed = Result.map(parsedTemplate(toolBlockEngine, value, 1), ({ variables }) =>
      variables.some(({ path }) => path.join('.') === 'sent.id'),
    );
    return Result.getOrElse(parsed, Function.constant(false));
  }
  return (
    typeof value === 'object' && value !== null && Object.values(value).some((each) => readsTheRequestsMessage(each))
  );
}

export function isPlacedByTheRequest({ line }: TellingRoute): boolean {
  return line !== undefined && Object.values(line.with).some((each) => readsTheRequestsMessage(each));
}
