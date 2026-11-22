import { parsedTemplate, type RenderClock } from '@on.auto/definitions/template';
import {
  pointerIssues,
  sampleMoment,
  templateIssues,
  templatesIssues,
  toolBlockEngine,
  type TemplateSet,
} from '@on.auto/definitions/tool-blocks';
import { isToolName, toolNameShape } from '@on.auto/tool-servers/policy';
import { Result, Schema } from 'effect';

import { textsIn } from './json-texts.ts';

const ArgumentsSchema = Schema.Record(Schema.String, Schema.Json);

const callFields = {
  tool: Schema.optionalKey(
    Schema.String.annotate({
      description: 'A tool of the connection that makes the call, named as the server lists it',
    }),
  ),
  with: Schema.optionalKey(
    ArgumentsSchema.annotate({
      description: "Beside tool, its arguments, written as the arguments of a function's deliver are",
    }),
  ),
  method: Schema.optionalKey(
    Schema.Literals(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).annotate({
      description:
        "Beside url, the method of an HTTPS request that carries the connection's own credential as a bearer token",
    }),
  ),
  url: Schema.optionalKey(
    Schema.String.annotate({
      description: 'Beside method, the https URL of the request, written out up to its host, a Liquid template',
    }),
  ),
  body: Schema.optionalKey(
    ArgumentsSchema.annotate({
      description: 'Beside method and url, the JSON body of the request, written as with is',
    }),
  ),
};

export const SubscribeSchema = Schema.Struct({
  ...callFields,
  subscribed: Schema.Struct({
    id: Schema.String.annotate({
      description: 'A JSON Pointer into what the call answered, to the id of the subscription it made',
    }),
    expires_at: Schema.optionalKey(
      Schema.String.annotate({ description: 'A JSON Pointer to when the subscription lapses, where the answer says' }),
    ),
    secret: Schema.optionalKey(
      Schema.String.annotate({
        description: 'A JSON Pointer to the secret the service made for the subscription, where it makes one',
      }),
    ),
  }).annotate({ description: 'Where what the call answered names the subscription it made' }),
}).annotate({ description: 'The call that subscribes, a tool of the connection or an HTTP request' });

export const RenewSchema = Schema.Struct({
  ...callFields,
  renewed: Schema.optionalKey(
    Schema.Struct({
      expires_at: Schema.String.annotate({
        description: 'A JSON Pointer into what the call answered, to when the subscription lapses now',
      }),
    }),
  ),
}).annotate({ description: 'The call that renews a subscription before it lapses' });

export const UnsubscribeSchema = Schema.Struct(callFields).annotate({
  description: 'The call that removes a subscription, without which none is made',
});

export const IdentitySchema = Schema.Struct({
  tool: callFields.tool,
  with: Schema.optionalKey(
    ArgumentsSchema.annotate({ description: 'Beside tool, its arguments, written out as they are' }),
  ),
  method: callFields.method,
  url: Schema.optionalKey(
    Schema.String.annotate({ description: 'Beside method, the https URL of the request, written out whole' }),
  ),
  body: Schema.optionalKey(
    ArgumentsSchema.annotate({
      description: 'Beside method and url, the JSON body of the request, written out as it is',
    }),
  ),
  identified: Schema.Struct({
    id: Schema.String.annotate({ description: "A JSON Pointer into what the call answered, to the account's id" }),
    name: Schema.optionalKey(
      Schema.String.annotate({ description: "A JSON Pointer to the account's name, where the answer gives one" }),
    ),
  }).annotate({ description: 'Where what the call answered names that account' }),
}).annotate({
  description:
    'The call that asks the service which account the connection acts as, a tool of the connection or an HTTP request',
});

type Call = typeof UnsubscribeSchema.Type;

const sample = {
  with: {},
  sent: { conversation: 'C0123', id: '1699.1' },
  topic: 'C0123',
  webhook_url: 'https://runtime.example.com/v1/orgs/acme/playbooks/alpha/connections/chat/events',
  queue_url: 'https://events.example.com/queues/chat',
  secret: 'the secret of the subscription',
  subscription: { id: 'subscription-1', expires_at: sampleMoment },
  lease: { seconds: 259_200, expires_at: sampleMoment },
};

function templatesOf(what: string, names: readonly string[], structured: string): TemplateSet {
  return { names, what, sample, structured };
}

const thePlace = ['with', 'sent.conversation', 'sent.id'];

const theTopic = ['topic'];

const theLease = ['lease.seconds', 'lease.expires_at'];

const theSubscription = ['subscription.id', 'subscription.expires_at'];

type Receiving = 'webhook' | 'queue';

const theSecret = 'secret';

const theAddress: Readonly<Record<Receiving, readonly string[]>> = {
  webhook: ['webhook_url', theSecret],
  queue: ['queue_url'],
};

export const topicTemplates = templatesOf('a template of the topic of a subscription', thePlace, 'with');

const theSubject = 'subject';

export const eventTopicTemplates: TemplateSet = {
  names: [theSubject],
  what: 'a template of the topic of an event',
  sample: { subject: 'C0123' },
  structured: 'the list that split makes',
};

export function subscribeTemplates(receiving: Receiving): TemplateSet {
  return templatesOf(
    'a template of the call that subscribes',
    [...theTopic, ...theAddress[receiving], ...theLease],
    'lease',
  );
}

export const renewTemplates = templatesOf(
  'a template of the call that renews',
  [...theTopic, ...theSubscription, ...theLease],
  'subscription',
);

export const unsubscribeTemplates = templatesOf(
  'a template of the call that unsubscribes',
  [...theTopic, ...theSubscription],
  'subscription',
);

export const identityTemplates = templatesOf('the call that asks which account the connection acts as', [], 'with');

export interface Placed {
  readonly pointer: string;
  readonly detail: string;
}

const noLines: ReadonlyMap<string, number> = new Map();

const checkedOn: RenderClock = () => performance.now();

const writtenOutToItsHost = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#]|$)/u;

const notWrittenOut =
  "Expected an https URL written out up to its host, since the request carries the connection's credential there, with templates in its path and query alone";

const writtenOutWhole = /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:[/?#][^{}\s]*)?$/u;

export const notWrittenOutWhole = 'Expected an https URL written out whole';

export function isWrittenOutWhole(url: string): boolean {
  return writtenOutWhole.test(url);
}

const opensATemplate = /\{\{|\{%|\$\{/u;

function readsNoName({ names }: TemplateSet): boolean {
  return names.length === 0;
}

function writtenAsItIsIssues(set: TemplateSet, pointer: string, written: Schema.Json): readonly Placed[] {
  const detail = `Expected no template, since ${set.what} has nothing to fill in: write the text out as it is`;
  return textsIn(written, pointer)
    .filter(({ text }) => opensATemplate.test(text))
    .map((placed) => ({ pointer: placed.pointer, detail }));
}

function templatedIssues(set: TemplateSet, pointer: string, written: Call['with']): readonly Placed[] {
  if (written === undefined) {
    return [];
  }
  return readsNoName(set)
    ? writtenAsItIsIssues(set, pointer, written)
    : templatesIssues(set, written, { lines: noLines, pointer, inputSchema: undefined, clock: checkedOn });
}

export function textIssues(set: TemplateSet, pointer: string, text: string): readonly Placed[] {
  return templateIssues(set, text, { lines: noLines, pointer, inputSchema: undefined, clock: checkedOn });
}

function toolIssues(pointer: string, tool: string, call: Call, set: TemplateSet): readonly Placed[] {
  return [
    ...(isToolName(tool) ? [] : [{ pointer: `${pointer}/tool`, detail: `Expected ${toolNameShape}` }]),
    ...(call.body === undefined
      ? []
      : [{ pointer: `${pointer}/body`, detail: 'Expected body only beside method and url' }]),
    ...templatedIssues(set, `${pointer}/with`, call.with),
  ];
}

function readsTheName(text: string, name: string): boolean {
  const parsed = parsedTemplate(toolBlockEngine, text, 1);
  return Result.isSuccess(parsed) && parsed.success.variables.some(({ path }) => path[0] === name);
}

function readsTheSecret(text: string): boolean {
  return readsTheName(text, theSecret);
}

export function readsTheSubject(topic: string): boolean {
  return readsTheName(topic, theSubject);
}

const theSecretInTheAddress = 'Expected {{ secret }} in body, not in url';

function secretIssuesOf(pointer: string, url: string, set: TemplateSet): readonly Placed[] {
  return set.names.includes(theSecret) && readsTheSecret(url) ? [{ pointer, detail: theSecretInTheAddress }] : [];
}

function urlIssues(pointer: string, url: string | undefined, set: TemplateSet): readonly Placed[] {
  const at = `${pointer}/url`;
  if (url === undefined) {
    return [{ pointer: at, detail: 'Expected url beside method' }];
  }
  if (readsNoName(set)) {
    return isWrittenOutWhole(url) ? [] : [{ pointer: at, detail: notWrittenOutWhole }];
  }
  return writtenOutToItsHost.test(url)
    ? [...textIssues(set, at, url), ...secretIssuesOf(at, url, set)]
    : [{ pointer: at, detail: notWrittenOut }];
}

function requestIssues(pointer: string, call: Call, set: TemplateSet): readonly Placed[] {
  return [
    ...(call.method === undefined ? [{ pointer: `${pointer}/method`, detail: 'Expected method beside url' }] : []),
    ...urlIssues(pointer, call.url, set),
    ...(call.with === undefined ? [] : [{ pointer: `${pointer}/with`, detail: 'Expected with only beside tool' }]),
    ...(call.method === 'GET' && call.body !== undefined
      ? [{ pointer: `${pointer}/body`, detail: 'Expected no body: a GET request sends none' }]
      : []),
    ...templatedIssues(set, `${pointer}/body`, call.body),
  ];
}

const eitherWay =
  'Expected tool, or method and url, and not both: a call is a tool of the connection or a request to an address the entry names';

function isWrittenAsARequest(call: Call): boolean {
  return call.method !== undefined || call.url !== undefined;
}

export function isADeclaredRequest(call: Call | undefined): boolean {
  return call !== undefined && call.tool === undefined && isWrittenAsARequest(call);
}

export function callIssuesOf(pointer: string, call: Call, set: TemplateSet): readonly Placed[] {
  const asARequest = isWrittenAsARequest(call);
  if (call.tool === undefined) {
    return asARequest ? requestIssues(pointer, call, set) : [{ pointer, detail: 'Expected tool, or method and url' }];
  }
  return asARequest ? [{ pointer, detail: eitherWay }] : toolIssues(pointer, call.tool, call, set);
}

export function answerIssuesOf(pointers: readonly (readonly [string, string | undefined])[]): readonly Placed[] {
  return pointerIssues(noLines, pointers);
}

export function placesTheSecret(call: Call): boolean {
  const written = { ...call.with, ...call.body, ...(call.url === undefined ? {} : { url: call.url }) };
  return textsIn(written, '').some(({ text }) => readsTheSecret(text));
}
