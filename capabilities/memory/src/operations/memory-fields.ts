import { Result, Schema } from 'effect';

import {
  aboutProblem,
  dayProblem,
  expiryOf,
  isMemoryId,
  memoryBounds,
  tagProblem,
  textProblem,
  wordsProblem,
} from '../document/memory-bounds.ts';
import { MemoryScopeSchema } from '../facts/memory-facts.ts';

function holds(problem: (text: string) => string | undefined): (text: string) => boolean {
  return (text) => problem(text) === undefined;
}

function memoryIdFieldOf(description: string) {
  return Schema.String.annotate({ description }).check(
    Schema.makeFilter(isMemoryId, { expected: 'the id of a memory, as remember or recall answered it' }),
  );
}

export const MemoryIdField = memoryIdFieldOf('The id of the memory, as remember or recall answered it');

const TextField = Schema.String.annotate({
  description: 'What to remember, 1 to 2,000 characters, as plain text',
}).check(
  Schema.makeFilter(holds(textProblem), {
    expected: `text of 1 to ${memoryBounds.mostTextCharacters.toLocaleString('en')} characters`,
  }),
);

const TagField = Schema.String.check(
  Schema.makeFilter(holds(tagProblem), {
    expected: 'a tag: 1 to 32 lowercase letters, digits and hyphens, starting with a letter or a digit',
  }),
);

const TagsField = Schema.Array(TagField).check(Schema.isMaxLength(memoryBounds.mostTags));

const DayField = Schema.String.check(Schema.makeFilter(holds(dayProblem), { expected: 'a day, as YYYY-MM-DD' }));

const AboutField = Schema.Struct({ from: DayField, to: DayField })
  .annotate({ description: 'The days the memory is about, from and to, each as YYYY-MM-DD' })
  .check(
    Schema.makeFilter((about: { readonly from: string; readonly to: string }) => aboutProblem(about) === undefined, {
      expected: 'a span whose to is no earlier than its from',
    }),
  );

const ExpiresField = Schema.String.annotate({
  description: 'How long it is kept, from P1D to P3650D; kept until forgotten when left out',
}).check(
  Schema.makeFilter((text: string) => Result.isSuccess(expiryOf(text)), {
    expected: `an ISO 8601 duration from P${memoryBounds.shortestExpiryDays}D to P${memoryBounds.longestExpiryDays}D, such as P30D`,
  }),
);

export const RememberInputSchema = Schema.Struct({
  text: TextField,
  tags: Schema.optionalKey(
    TagsField.annotate({ description: 'At most 8 tags, each 1 to 32 lowercase letters, digits and hyphens' }),
  ),
  scope: Schema.optionalKey(
    MemoryScopeSchema.annotate({
      description:
        "Who keeps it: playbook, the default, for what is learned about this playbook's own work; organization for what is true of the team or the business, which every playbook of the organization recalls",
    }),
  ),
  about: Schema.optionalKey(AboutField),
  expires: Schema.optionalKey(ExpiresField),
  replaces: Schema.optionalKey(
    memoryIdFieldOf('The id of a memory this one replaces as its next version, in the same scope'),
  ),
});

const RecallScopeSchema = Schema.Literals(['playbook', 'organization', 'both']);

export const RecallInputSchema = Schema.Struct({
  words: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Words every memory recalled holds, in any case, at most 1,000 characters; all when left out',
    }).check(
      Schema.makeFilter(holds(wordsProblem), {
        expected: `words of at most ${memoryBounds.mostWordsCharacters.toLocaleString('en')} characters`,
      }),
    ),
  ),
  tags: Schema.optionalKey(TagsField.annotate({ description: 'Tags every memory recalled has' })),
  scope: Schema.optionalKey(
    RecallScopeSchema.annotate({
      description: "Whose memories to recall: the playbook's, the organization's, or both, the default",
    }),
  ),
  most_characters: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: memoryBounds.mostRecalledCharacters })).annotate({
      description: 'The most characters of text to recall across the memories, 4,000 when left out, at most 16,000',
    }),
  ),
});
