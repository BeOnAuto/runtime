import { mostNoticeCharacters } from '@on.auto/phrasing';
import { Option, Schema } from 'effect';

const mostNotices = 3;

const certainties = ['exact', 'likely', 'reminder'] as const;

const NoticeSchema = Schema.Struct({
  kind: Schema.String.annotate({ description: 'What was noticed, as a code that stays the same' }),
  detail: Schema.String.check(Schema.isMaxLength(mostNoticeCharacters)).annotate({
    description: 'What was noticed and what to check, in words',
  }),
  at: Schema.optionalKey(
    Schema.String.annotate({ description: 'Where it is in the document, as a JSON pointer such as /tools' }),
  ),
  certainty: Schema.Literals(certainties).annotate({
    description:
      'exact when the fact was checked, likely when it usually means a mistake, reminder when it could not be checked',
  }),
}).annotate({ identifier: 'Notice', description: 'Something to double-check in what was just accepted' });

export type Notice = typeof NoticeSchema.Type;

interface WithNotices {
  readonly notices?: readonly Notice[];
  readonly before_going_on?: string;
}

export function noticesFields() {
  return {
    notices: Schema.optionalKey(
      Schema.Array(NoticeSchema).check(Schema.isMaxLength(mostNotices)).annotate({
        description:
          'What to double-check in what was just accepted; the action is done either way. Left out when there is nothing to check',
      }),
    ),
    before_going_on: Schema.optionalKey(
      Schema.String.annotate({
        description: 'What to do with the notices before going on, in words; present only with notices',
      }),
    ),
  };
}

const countedInWords = ['One thing', 'Two things'];

export function beforeGoingOnOf(count: number): string {
  const one = count === 1;
  const things = countedInWords.at(count - 1) ?? 'Three things';
  return `${things} to double-check ${one ? 'is' : 'are'} in notices: if you are sure of what you did, carry on and tell the person in one sentence why you kept ${one ? 'it' : 'them'}; if not, now is a good time to fix ${one ? 'it' : 'them'}.`;
}

function cutAtAWord(text: string): string {
  if (text.length <= mostNoticeCharacters) {
    return text;
  }
  const cut = text.slice(0, mostNoticeCharacters - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function withNotices<Output extends object>(output: Output, notices: readonly Notice[]): Output & WithNotices {
  const kept = notices
    .slice(0, mostNotices)
    .map(({ kind, detail, at, certainty }): Notice =>
      at === undefined
        ? { kind, detail: cutAtAWord(detail), certainty }
        : { kind, detail: cutAtAWord(detail), at, certainty },
    );
  return kept.length === 0 ? output : { notices: kept, before_going_on: beforeGoingOnOf(kept.length), ...output };
}

const noticesOf = Schema.decodeUnknownOption(Schema.Struct({ notices: Schema.Array(NoticeSchema) }));

export function noticesIn(output: unknown): readonly Notice[] {
  return Option.match(noticesOf(output), { onNone: () => [], onSome: ({ notices }) => notices });
}
