import { JsonPointer, Result, type Schema } from 'effect';

import {
  derivedRule,
  normalizedWord,
  replyRuleBounds,
  stringPropertiesOf,
  wordBytesOf,
  type ReplyRule,
  type RulePart,
  type StringProperty,
  type WrittenRule,
} from './reply-rule.ts';

interface RuleIssue {
  readonly pointer: string;
  readonly detail: string;
}

type Checked<A> = Result.Result<A, readonly RuleIssue[]>;

type Written = WrittenRule[string];

type Words = Readonly<Record<string, readonly string[]>>;

function placeOf(...path: readonly string[]): string {
  return `/reply${path.map((segment) => `/${JsonPointer.escapeToken(segment)}`).join('')}`;
}

function fromOf(written: Written): RulePart['from'] {
  return typeof written === 'string' ? written : written.from;
}

function wordsOf(written: Written): Words | undefined {
  return typeof written === 'string' ? undefined : written.words;
}

function boundIssues(name: string, words: Words): readonly RuleIssue[] {
  const values = Object.entries(words);
  const tooMany = values.length > replyRuleBounds.values;
  return [
    ...(tooMany
      ? [
          {
            pointer: placeOf(name, 'words'),
            detail: `A reply rule lists words for at most ${replyRuleBounds.values} values`,
          },
        ]
      : []),
    ...values
      .filter(([, listed]: readonly [string, readonly string[]]) => listed.length > replyRuleBounds.wordsPerValue)
      .map(([value]: readonly [string, readonly string[]]) => ({
        pointer: placeOf(name, 'words', value),
        detail: `A value takes at most ${replyRuleBounds.wordsPerValue} words`,
      })),
    ...values
      .filter(([, listed]: readonly [string, readonly string[]]) =>
        listed.some((word) => wordBytesOf(word) > replyRuleBounds.wordBytes),
      )
      .map(([value]: readonly [string, readonly string[]]) => ({
        pointer: placeOf(name, 'words', value),
        detail: `A word takes at most ${replyRuleBounds.wordBytes} bytes`,
      })),
  ];
}

function meaningIssues(name: string, values: readonly string[], words: Words): readonly RuleIssue[] {
  const meanings = new Map(values.map((value) => [normalizedWord(value), value]));
  return Object.entries(words).flatMap(([value, listed]: readonly [string, readonly string[]]) =>
    listed.flatMap((word) => {
      const meant = meanings.get(normalizedWord(word));
      meanings.set(normalizedWord(word), meant ?? value);
      return meant === undefined || meant === value
        ? []
        : [
            {
              pointer: placeOf(name, 'words', value),
              detail: `${word} means ${meant} already; a word means one value only`,
            },
          ];
    }),
  );
}

function wordPart(name: string, property: StringProperty, words: Words): Checked<RulePart> {
  const values = property.values ?? [];
  const unknown = Object.keys(words)
    .filter((value) => !values.includes(value))
    .map((value) => ({
      pointer: placeOf(name, 'words', value),
      detail: `${value} is not a value of the enum of ${name}`,
    }));
  const issues = [
    ...(property.values === undefined
      ? [
          {
            pointer: placeOf(name),
            detail: `${name} has no enum, so the first word of a reply cannot be read as one of its values`,
          },
        ]
      : []),
    ...unknown,
    ...boundIssues(name, words),
    ...meaningIssues(name, values, words),
  ];
  return issues.length > 0
    ? Result.fail(issues)
    : Result.succeed({ from: 'word', words: Object.fromEntries(values.map((value) => [value, words[value] ?? []])) });
}

function checkedPart(name: string, written: Written, property: StringProperty | undefined): Checked<RulePart> {
  const from = fromOf(written);
  const words = wordsOf(written);
  if (property === undefined) {
    return Result.fail([
      {
        pointer: placeOf(name),
        detail: `${name} is not a string property of output.schema; a reply rule names its top-level string properties`,
      },
    ]);
  }
  if (from === 'word') {
    return wordPart(name, property, words ?? {});
  }
  return words === undefined
    ? Result.succeed({ from })
    : Result.fail([{ pointer: placeOf(name, 'words'), detail: `Only a part read from the first word takes words` }]);
}

const noRule = Result.succeed(null);

export function checkedRule(
  written: WrittenRule | undefined,
  answerSchema: Schema.JsonObject | undefined,
): Checked<ReplyRule | null> {
  if (answerSchema === undefined) {
    return written === undefined
      ? noRule
      : Result.fail([{ pointer: '/reply', detail: 'A notification takes no answer, so it takes no reply rule' }]);
  }
  if (written === undefined) {
    return Result.succeed(derivedRule(answerSchema) ?? null);
  }
  const properties = stringPropertiesOf(answerSchema);
  const issues: RuleIssue[] = [];
  const rule: Record<string, RulePart> = {};
  for (const [name, part] of Object.entries(written)) {
    Result.match(checkedPart(name, part, properties.get(name)), {
      onFailure: (found) => {
        issues.push(...found);
      },
      onSuccess: (checked) => {
        rule[name] = checked;
      },
    });
  }
  return issues.length > 0 ? Result.fail(issues) : Result.succeed(rule);
}
