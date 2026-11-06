import { Schema } from 'effect';

import { keyPatternIssueOf } from './key-patterns.ts';

const mostInstructionsCharacters = 1000;

const mostExampleCharacters = 100;

const ellipsis = '…';

const htmlOpening = /<[A-Za-z/!?]/u;

const withoutHtml = 'Expected Markdown without HTML: write a link as [the page](https://…) and no tag';

const notAKeyPage =
  'Expected the https address of the page where the key is made, written out from https://, with no user name or password in it';

const unelided = `Expected an ellipsis, ${ellipsis}, in place of the characters of the key, as in ghp_${ellipsis}, so that an example never reads as a key`;

function isAKeyPage(page: string): boolean {
  const address = URL.parse(page);
  return address !== null && page.startsWith('https://') && address.username === '' && address.password === '';
}

function described(description: string) {
  return Schema.String.annotate({ description });
}

export const keyFields = {
  instructions: (description: string) =>
    described(description).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(mostInstructionsCharacters),
      Schema.makeFilter((instructions: string) => (htmlOpening.test(instructions) ? withoutHtml : undefined)),
    ),
  key_page: (description: string) =>
    described(description).check(Schema.makeFilter((page: string) => (isAKeyPage(page) ? undefined : notAKeyPage))),
  example: (description: string) =>
    described(description).check(
      Schema.isMaxLength(mostExampleCharacters),
      Schema.makeFilter((example: string) => (example.includes(ellipsis) ? undefined : unelided)),
    ),
  pattern: (description: string) =>
    described(description).check(Schema.makeFilter((pattern: string) => keyPatternIssueOf(pattern))),
};

export const keyWayFields = {
  instructions: Schema.optionalKey(
    keyFields.instructions(
      'For secret, how a person makes the key, in Markdown without HTML of at most 1,000 characters: where it is made, the plan or role it needs, the permissions it needs and its format',
    ),
  ),
  key_page: Schema.optionalKey(
    keyFields.key_page('For secret, the https address of the page where a person makes the key'),
  ),
  example: Schema.optionalKey(
    keyFields.example(
      'For secret, what a key looks like, with an ellipsis in place of its characters, such as ghp_…, which the field of the key shows',
    ),
  ),
  pattern: Schema.optionalKey(
    keyFields.pattern(
      'For secret, beside example, the regular expression from ^ to $ every key matches, of at most 200 characters, by which the runtime refuses a value of another format',
    ),
  ),
};

interface KeyWay {
  readonly kind: string;
  readonly example?: string;
  readonly pattern?: string;
}

const exampleOfThePattern =
  'Expected example beside pattern, which shows the person the format of the key the pattern holds a value to';

export function keyWayIssuesOf({ kind, pattern, example }: KeyWay): readonly Schema.FilterIssue[] {
  const lacksIt = kind === 'secret' && pattern !== undefined && example === undefined;
  return lacksIt ? [{ path: ['example'], issue: exampleOfThePattern }] : [];
}

export const keyFieldNames = ['instructions', 'key_page', 'example', 'pattern'] as const;

export type KeyFieldName = (typeof keyFieldNames)[number];
