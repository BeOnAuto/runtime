import { isToolName, toolNameShape } from '@on.auto/tool-servers/policy';
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

export const ValueNameSchema = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/u, {
    expected: 'the name of a value of the app, 1 to 64 lowercase letters, digits and underscores',
  }),
);

interface Exemplified {
  readonly example?: string | undefined;
  readonly pattern?: string | undefined;
}

const exampleOfThePattern =
  'Expected example beside pattern, which shows the person the format of the key the pattern holds a value to';

function exampleIssuesOf({ pattern, example }: Exemplified): readonly Schema.FilterIssue[] {
  return pattern !== undefined && example === undefined ? [{ path: ['example'], issue: exampleOfThePattern }] : [];
}

const AppCredentialSchema = Schema.Struct({
  name: ValueNameSchema.annotate({
    description:
      "Its name, as the vendor names it, such as app_level_token, by which a websocket destination of the entry names it as its credential and give_credential's app_credentials takes it",
  }),
  description: Schema.String.check(Schema.isMinLength(1)).annotate({
    description: 'What a person reads of it: the label of the field it is given in, beside the field of the key',
  }),
  instructions: keyFields.instructions(
    'How a person makes it, in Markdown without HTML of at most 1,000 characters, which its field shows',
  ),
  key_page: Schema.optionalKey(keyFields.key_page('The https address of the page where a person makes it')),
  example: Schema.optionalKey(
    keyFields.example('What it looks like, with an ellipsis in place of its characters, which its field shows'),
  ),
  pattern: Schema.optionalKey(
    keyFields.pattern(
      'Beside example, the regular expression from ^ to $ every such value matches, of at most 200 characters, by which the runtime refuses a value of another format',
    ),
  ),
})
  .check(Schema.makeFilter(exampleIssuesOf))
  .annotate({ description: 'An app credential a person may give beside the key' });

export type AppCredential = typeof AppCredentialSchema.Type;

const KeyTestSchema = Schema.Struct({
  tool: Schema.String.check(
    Schema.makeFilter((tool: string) => (isToolName(tool) ? undefined : `Expected ${toolNameShape}`)),
  ).annotate({ description: "The tool, as the provider's server or document names it" }),
}).annotate({
  description:
    'For secret, the tool that checks a key: a tool that needs no arguments and is marked reads, which the runtime calls once with the key a person gives before it keeps anything; a key the service refuses is refused, and where the call ends any other way than in a result the runtime keeps nothing and answers that the key could not be checked',
});

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
  app_credentials: Schema.optionalKey(
    Schema.Array(AppCredentialSchema).check(Schema.isMinLength(1)).annotate({
      description:
        'For secret, the app credentials a person may give beside the key, such as an app-level token, each optional to them, in the order the page shows them; one is offered only where a websocket destination of the entry names it and the runtime opens sockets, and the runtime keeps each sealed as it keeps the key',
    }),
  ),
  test: Schema.optionalKey(KeyTestSchema),
};

interface KeyWay extends Exemplified {
  readonly kind: string;
  readonly app_credentials?: readonly { readonly name: string }[] | undefined;
}

const namedOnce = 'Expected a name no earlier app credential of the way has';

function appCredentialIssuesOf({ app_credentials: given = [] }: KeyWay): readonly Schema.FilterIssue[] {
  const names = given.map(({ name }) => name);
  return names.flatMap((name, index) =>
    names.indexOf(name) === index ? [] : [{ path: ['app_credentials', index, 'name'], issue: namedOnce }],
  );
}

export function keyWayIssuesOf(way: KeyWay): readonly Schema.FilterIssue[] {
  return way.kind === 'secret' ? [...exampleIssuesOf(way), ...appCredentialIssuesOf(way)] : [];
}

export const keyFieldNames = ['instructions', 'key_page', 'example', 'pattern'] as const;

export type KeyFieldName = (typeof keyFieldNames)[number];
