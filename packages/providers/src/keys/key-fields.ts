import { isJsonPointer } from '@on.auto/tool-servers';
import { isToolName, toolNameShape } from '@on.auto/tool-servers/policy';
import { Schema } from 'effect';

import { keyPatternIssueOf } from './key-patterns.ts';

const mostInstructionsCharacters = 1000;

const mostExampleCharacters = 100;

const mostKeyPageTitleCharacters = 40;

const ellipsis = '…';

const htmlOpening = /<[A-Za-z/!?]/u;

const withoutHtml = 'Expected Markdown without HTML: write a link as [the page](https://…) and no tag';

const notAKeyPage =
  'Expected the https address of the page where the key is made, written out from https://, with no user name or password in it';

const notAPage =
  'Expected the https address of the page of the service, written out from https://, with no user name or password in it';

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

const mostStepTitleCharacters = 60;

export const mostPageSteps = 4;

function stepTitle(description: string) {
  return described(description).check(Schema.isMinLength(1), Schema.isMaxLength(mostStepTitleCharacters));
}

function buttonLabel(description: string) {
  return described(description).check(Schema.isMinLength(1), Schema.isMaxLength(mostKeyPageTitleCharacters));
}

const StepSchema = Schema.Struct({
  title: stepTitle('The heading of the step, in at most 60 characters'),
  instructions: keyFields.instructions(
    'What the person does in the step, in Markdown without HTML of at most 1,000 characters',
  ),
});

const PageStepSchema = Schema.Struct({
  title: stepTitle('The heading of the step, in at most 60 characters'),
  instructions: keyFields.instructions(
    'What the person does in the step, in Markdown without HTML of at most 1,000 characters',
  ),
  page: described('The https address of the page of the service where the person does the step').check(
    Schema.makeFilter((page: string) => (isAKeyPage(page) ? undefined : notAPage)),
  ),
  page_title: buttonLabel('The label of the button that opens page, in at most 40 characters'),
}).annotate({ description: 'A step the person does on a page of the service' });

export function stepsSchemaOf(mostPages: number) {
  return Schema.Struct({
    key_page: Schema.optionalKey(
      StepSchema.annotate({ description: 'The step of the page where the key is made, above the button to key_page' }),
    ),
    pages: Schema.optionalKey(
      Schema.Array(PageStepSchema)
        .check(Schema.isMinLength(1), Schema.isMaxLength(mostPages))
        .annotate({
          description: `The steps the person does on other pages of the service, in order, after the step of key_page and before the step of the key, at most ${String(mostPages)}`,
        }),
    ),
    key: Schema.optionalKey(
      StepSchema.annotate({
        description:
          "The step of the key, above its field; the page shows its instructions in place of the way's instructions",
      }),
    ),
    connected: Schema.optionalKey(
      StepSchema.annotate({
        description: 'What the person does once the connection is connected, shown after approving',
      }),
    ),
  }).annotate({
    description:
      "For secret, client_credentials, jwt_bearer, authorization and token_exchange, the heading and paragraph of each step of the page where a person approves the connection, each a title and instructions; for authorization, the steps of making the organization's own OAuth client, shown where the connection goes under it. For token_exchange, the instructions may name {issuer} and {subject}, the issuer of the tokens Auto signs and the subject it signs them for, which the page shows beside the steps to copy",
  });
}

const StepsSchema = stepsSchemaOf(mostPageSteps);

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
  title: Schema.optionalKey(
    stepTitle(
      'The heading of its step on the page where a person approves the connection, in at most 60 characters, above its instructions',
    ),
  ),
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

const notAPointer = 'Expected a JSON Pointer into the answer of the tool, such as /items';

const PointerSchema = Schema.String.check(
  Schema.makeFilter((pointer: string) => (isJsonPointer(pointer) ? undefined : notAPointer)),
);

const notAPointerIntoTheItem =
  'Expected a JSON Pointer into each item of the list, such as /name, or an empty one where each item is the name';

const ItemPointerSchema = Schema.String.check(
  Schema.makeFilter((pointer: string) =>
    pointer === '' || isJsonPointer(pointer) ? undefined : notAPointerIntoTheItem,
  ),
);

const ReachedSchema = Schema.Struct({
  list: PointerSchema.annotate({ description: 'The JSON Pointer to the list in the answer of the tool' }),
  name: ItemPointerSchema.annotate({
    description:
      'The JSON Pointer to the name a person reads of each thing the connection reaches, within each item of the list, or an empty pointer where each item is the name itself',
  }),
}).annotate({
  description:
    'For token_exchange, where the answer of the tool lists the things the connection reaches, and their names',
});

const KeyTestSchema = Schema.Struct({
  tool: Schema.String.check(
    Schema.makeFilter((tool: string) => (isToolName(tool) ? undefined : `Expected ${toolNameShape}`)),
  ).annotate({ description: "The tool, as the provider's server or document names it" }),
  with: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Json).annotate({
      description: 'For token_exchange, the arguments the tool is called with, by name',
    }),
  ),
  reached: Schema.optionalKey(ReachedSchema),
}).annotate({
  description:
    'For secret, the tool that checks a key: a tool that needs no arguments and is marked reads, which the runtime calls once with the key a person gives before it keeps anything; a key the service refuses is refused, and where the call ends any other way than in a result the runtime keeps nothing and answers that the key could not be checked. For token_exchange, the tool that checks what a connection reaches: a tool marked reads, called with the arguments in with, whose answer lists in reached the things the connection reaches',
});

export const keyWayFields = {
  instructions: Schema.optionalKey(
    keyFields.instructions(
      'For secret, how a person makes the key, in Markdown without HTML of at most 1,000 characters: where it is made, the plan or role it needs, the permissions it needs and its format',
    ),
  ),
  key_page: Schema.optionalKey(
    keyFields.key_page(
      "For secret, the https address of the page where a person makes the key; for client_credentials, of the page where a person makes the client; for jwt_bearer, of the page where a person makes the key file; for authorization, of the page where a person makes the organization's own OAuth client; for token_exchange, of the page where a person lets the tokens Auto signs act as the account",
    ),
  ),
  key_page_title: Schema.optionalKey(
    buttonLabel(
      'For secret, client_credentials, jwt_bearer, authorization and token_exchange, the label of the button that opens key_page, such as Create your Tracker app, in at most 40 characters',
    ),
  ),
  steps: Schema.optionalKey(StepsSchema),
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

interface TestedWay {
  readonly kind: string;
  readonly test?: typeof KeyTestSchema.Type | undefined;
}

const reachedExpected =
  'Expected reached, which the test of a token_exchange way takes, since it says where the answer lists what the connection reaches';

const onlyOfAnExchange =
  'Expected no with or reached: only the test of a token_exchange way takes them, and the test of a key calls a tool that needs no arguments';

export function testIssuesOf({ kind, test }: TestedWay): readonly Schema.FilterIssue[] {
  if (test === undefined) {
    return [];
  }
  if (kind === 'token_exchange') {
    return test.reached === undefined ? [{ path: ['test'], issue: reachedExpected }] : [];
  }
  return (['with', 'reached'] as const)
    .filter((field) => test[field] !== undefined)
    .map((field) => ({ path: ['test', field], issue: onlyOfAnExchange }));
}

export const keyFieldNames = ['instructions', 'key_page', 'example', 'pattern'] as const;

export type KeyFieldName = (typeof keyFieldNames)[number];
