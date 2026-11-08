import { Array as Arr, Option, Schema } from 'effect';

import { chatCompletion } from '../provider-testing/provider-replies.ts';
import { jsonResponse, recordingFetch, type RecordingFetch } from '../provider-testing/recording-fetch.ts';
import { writtenFormOf } from '../schema/schema-round-trip.ts';
import type { Environment } from '../settings/setting-values.ts';
import { checkCases, type CheckCase } from './check-cases.ts';

export const checkGateways: Environment = {
  MODEL_GATEWAYS: JSON.stringify([
    {
      name: 'scripted',
      base_url: 'https://scripted.example/v1',
      structured_outputs: true,
      cost_header: 'x-call-cost',
      expose_provider_messages: true,
    },
    { name: 'describing', base_url: 'https://describing.example/v1' },
  ]),
};

const contactCard = {
  name: 'Ada Lovelace',
  email: null,
  phone: null,
  mobile: null,
  street: null,
  city: 'London',
  region: null,
  postcode: null,
  country: 'United Kingdom',
  company: null,
  title: null,
  department: null,
  website: null,
  birthday: '1815-12-10',
  language: 'English',
  timezone: null,
  pronouns: null,
  notes: null,
};

const account = {
  id: '9b2f6c1e-4d7a-4f3b-8e21-5c9d0a7b3e44',
  name: 'Northwind Traders',
  tier: 'pro',
  region: 'emea',
  owner: { name: 'Dana Reyes', email: 'dana@northwind.example', phone: '+44 20 7946 0000' },
  organisation: {
    division: {
      name: 'Retail',
      head: { name: 'Lee Park', email: 'lee@northwind.example' },
      department: {
        name: 'Payments',
        cost_centre: 'PAY-01',
        team: {
          name: 'Checkout',
          lead: { name: 'Sam Okafor', email: 'sam@northwind.example' },
          size: 12,
          budget: { amount: 12_000, currency: 'EUR' },
          site: {
            city: 'Leeds',
            address: {
              street: '1 Market Street',
              postcode: 'LS1 6DT',
              building: { name: 'Mill', floor: { number: 3, wing: 'east' } },
            },
          },
        },
      },
    },
  },
  website: 'https://northwind.example',
};

const review = {
  verdict: { kind: 'approve', limit: { amount: 5000, currency: 'EUR' }, until: '2026-12-31' },
  spend: { '2026-09': { amount: 4100, currency: 'EUR' }, '2026-10': { amount: 3900, currency: 'EUR' } },
  follow_up: { by: '2026-12-01', owner: 'Dana Reyes' },
};

const checkAnswers: ReadonlyMap<string, Schema.Json> = new Map<string, Schema.Json>([
  [
    'categories',
    {
      unit: 'millions',
      values: [
        { name: 'Tokyo', value: 37.1 },
        { name: 'Delhi', value: 33.8 },
        { name: 'Shanghai', value: 29.9 },
      ],
    },
  ],
  [
    'series',
    {
      unit: 'C',
      period: 'month',
      lines: [
        {
          name: 'Oslo',
          points: [
            { at: '2025-01', value: -4.3 },
            { at: '2025-02', value: -4 },
            { at: '2025-03', value: -0.2 },
            { at: '2025-04', value: 4.5 },
            { at: '2025-05', value: 10.8 },
            { at: '2025-06', value: 15.2 },
          ],
        },
      ],
    },
  ],
  [
    'table',
    {
      columns: [{ name: 'City' }, { name: 'Population', unit: 'millions' }],
      rows: [
        ['Paris', 2.1],
        ['Marseille', 0.87],
        ['Lyon', 0.52],
      ],
    },
  ],
  ['text', { text: 'A checklist keeps every step in view when attention is short.' }],
  ['reference', { account, review }],
  [
    'described',
    {
      title: 'Brewing tea',
      sections: [
        { heading: 'Choose the tea' },
        { heading: 'Brew it', sections: [{ heading: 'Heat the water' }, { heading: 'Steep' }] },
      ],
    },
  ],
  [
    'tools',
    {
      unit: 'millions',
      values: [
        { name: 'Lyon', value: 0.52 },
        { name: 'Lille', value: 0.24 },
      ],
    },
  ],
  ['seventeen_unions', contactCard],
  [
    'large_max_items',
    {
      values: [
        { name: 'Tokyo', value: 37.1 },
        { name: 'Yokohama', value: 3.8 },
        { name: 'Osaka', value: 2.7 },
        { name: 'Nagoya', value: 2.3 },
        { name: 'Sapporo', value: 2 },
      ],
    },
  ],
]);

const ChatRequestSchema = Schema.Struct({
  model: Schema.String,
  messages: Schema.Array(Schema.Struct({ role: Schema.String, content: Schema.Unknown })),
  response_format: Schema.optionalKey(Schema.Unknown),
  tools: Schema.optionalKey(Schema.Unknown),
});

const chatRequestOf = Schema.decodeUnknownSync(ChatRequestSchema);

interface Asked {
  readonly model: string;
  readonly checked: CheckCase;
  readonly enforced: boolean;
  readonly toolsOffered: boolean;
  readonly toolsAnswered: boolean;
  readonly repairing: boolean;
}

const askedAgain = 'Answer again in full';

function askedOf(body: unknown): Asked {
  const { model, messages, response_format: format, tools } = chatRequestOf(body);
  const told = messages.filter(({ role }) => role === 'user').map(({ content }) => content);
  return {
    model,
    checked: Option.getOrThrow(Arr.findFirst(checkCases, ({ prompt }) => told.includes(prompt))),
    enforced: format !== undefined,
    toolsOffered: tools !== undefined,
    toolsAnswered: messages.some(({ role }) => role === 'tool'),
    repairing: told.some((text) => typeof text === 'string' && text.includes(askedAgain)),
  };
}

type Reply = (asked: Asked) => Response | Promise<Response>;

function answeredWith(text: string): Response {
  return jsonResponse(chatCompletion(text), 200, { 'x-call-cost': '0.25' });
}

function answerOf({ checked, enforced }: Asked): string {
  const answer = Option.getOrThrow(Option.fromNullishOr(checkAnswers.get(checked.name)));
  return enforced
    ? JSON.stringify(writtenFormOf(checked.output.schema.document, answer))
    : `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``;
}

interface ToolCall {
  readonly id: string;
  readonly input: Schema.Json;
}

function calledWith(calls: readonly ToolCall[]): Response {
  const toolCalls = calls.map(({ id, input }) => ({
    id,
    type: 'function',
    function: { name: 'city_population', arguments: JSON.stringify(input) },
  }));
  return jsonResponse(
    {
      id: 'chatcmpl-check-tools',
      object: 'chat.completion',
      created: 1_741_569_952,
      model: 'scripted',
      choices: [
        { index: 0, message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
    },
    200,
    { 'x-call-cost': '0.25' },
  );
}

function failedWith(status: number, message: string, headers: Readonly<Record<string, string>> = {}): Response {
  return jsonResponse({ error: { message, type: null, param: null, code: String(status) } }, status, headers);
}

function refused(): Response {
  return failedWith(400, "litellm.BadRequestError: Invalid schema for response_format 'response'");
}

function passing(asked: Asked): Response {
  return asked.toolsOffered && !asked.toolsAnswered
    ? calledWith([
        { id: 'call_lyon', input: { city: 'Lyon' } },
        { id: 'call_lille', input: { city: 'Lille' } },
      ])
    : answeredWith(answerOf(asked));
}

function repairing(asked: Asked): Response {
  const firstAnswer = asked.toolsAnswered || !asked.toolsOffered;
  return firstAnswer && !asked.repairing ? answeredWith('{"answer":"pending"}') : passing(asked);
}

const replies: ReadonlyMap<string, Reply> = new Map<string, Reply>([
  ['passing', passing],
  ['repairing', repairing],
  ['invalid', () => answeredWith('Here is what I found.')],
  ['tools-blocked', (asked) => answeredWith(answerOf(asked))],
  ['refusing', (asked) => (asked.enforced ? refused() : passing(asked))],
  ['refusing-unanswered', (asked) => (asked.enforced ? refused() : answeredWith('Here is what I found.'))],
  ['bounded', (asked) => (asked.enforced && asked.checked.kind === 'canary' ? refused() : passing(asked))],
  ['refusing-all', refused],
  ['limited', () => failedWith(429, 'litellm.RateLimitError: slow down', { 'retry-after-ms': '0' })],
  ['missing', () => failedWith(404, 'litellm.NotFoundError: no such model')],
  [
    'looping',
    (asked) =>
      asked.toolsOffered
        ? calledWith([
            { id: 'call_atlantis', input: { city: 'Atlantis' } },
            { id: 'call_town', input: { town: 'Lyon' } },
          ])
        : passing(asked),
  ],
  ['broken', () => Promise.reject(new Error('The socket was torn down'))],
]);

export function scriptedCheckFetch(): RecordingFetch {
  return recordingFetch(({ body }) => {
    const asked = askedOf(body);
    return Option.getOrThrow(Option.fromNullishOr(replies.get(asked.model)))(asked);
  });
}
