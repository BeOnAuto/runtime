import type {
  AnsweredOnce,
  CalledOnce,
  ConnectionRequest,
  NotOfferedBecause,
  OneCall,
  RequestedOnce,
  SentCallFailedBecause,
  ServerFailedBecause,
} from '@on.auto/tool-servers';
import { Effect, Option, Redacted, type Schema } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import { eventDestinationOf } from '../reading/provider-list.ts';
import type {
  Receiving,
  Subscribed,
  SubscriptionPlace,
  SubscriptionPorts,
} from '../subscriptions/subscription-ports.ts';
import { trackerOverASocket } from './event-destinations.ts';
import { providersOf } from './fixture-providers.ts';

export function destinationOf(written: object, type: Destination['type'] = 'webhook'): Destination {
  const entry = { ...trackerOverASocket, events: { destinations: [written] } };
  return Option.getOrThrow(Option.fromNullishOr(eventDestinationOf(providersOf(entry), 'tracker', type)));
}

export function declared<Part>(part: Part | undefined): Part {
  return Option.getOrThrow(Option.fromNullishOr(part));
}

export const place: SubscriptionPlace = { org: 'acme', playbook: 'alpha', connection: 'tracker' };

type Sent = { readonly tool: OneCall } | { readonly request: ConnectionRequest };

export interface FakeService {
  readonly ports: SubscriptionPorts;
  readonly sent: () => readonly Sent[];
  readonly callbacksAsked: () => readonly (readonly [SubscriptionPlace, Receiving])[];
}

export interface Serving {
  readonly callbacks?: Partial<Readonly<Record<Receiving, string>>>;
  readonly mostRequestBytes?: number;
}

export const theCallback = 'https://runtime.example.com/v1/orgs/acme/playbooks/alpha/connections/tracker/events';

export const theQueue = 'https://events.example.com/queues/tracker';

const answeredFields = { is_error: false, result_bytes: 2, duration_ms: 3, jsonrpc_id: 1 };

const answering = { kind: 'answered', mark: 'acts', detail: '', retryAfterMs: null } as const;

export function answeredWith(document: Schema.Json): CalledOnce {
  const text = JSON.stringify(document);
  return { ...answering, outcome: 'result', answer: { content: [{ type: 'text', text }] }, answered: answeredFields };
}

export function answeredStructured(document: Schema.Json): CalledOnce {
  return {
    ...answering,
    outcome: 'result',
    answer: { content: [], structuredContent: document },
    answered: answeredFields,
  };
}

export function answeredAsText(text: string): CalledOnce {
  return { ...answering, outcome: 'result', answer: { content: [{ type: 'text', text }] }, answered: answeredFields };
}

export const answeredNothing: CalledOnce = {
  ...answering,
  outcome: 'result',
  answer: { content: [] },
  answered: answeredFields,
};

export function refusedByTheTool(detail: string): CalledOnce {
  return { ...answering, detail, outcome: 'tool_error', answered: { ...answeredFields, is_error: true } };
}

const failedFields = { duration_ms: 3, jsonrpc_id: 1 };

export function failedAs(outcome: SentCallFailedBecause, detail = ''): CalledOnce {
  return { ...answering, detail, outcome, failed: { ...failedFields, because: outcome, detail } };
}

export type SentReason = NonNullable<Extract<AnsweredOnce, { readonly outcome: SentCallFailedBecause }>['because']>;

const limitedFields = { rate_limited: true } as const;

export function serverFailureAs(because: SentReason, detail = ''): CalledOnce {
  const limited = because === 'rate_limited' ? limitedFields : {};
  return {
    ...answering,
    detail,
    outcome: 'server_failure',
    failed: { ...failedFields, because: 'server_failure', ...limited },
    because,
  };
}

export const rateLimited: CalledOnce = serverFailureAs('rate_limited');

export function notOfferedAs(because: NotOfferedBecause, detail = ''): CalledOnce {
  return { kind: 'unopened', refused: 'tool_not_offered', because, detail };
}

export function serverFailedAs(because: ServerFailedBecause, detail = ''): CalledOnce {
  return { kind: 'unopened', refused: 'tool_server_failed', because, detail };
}

export const notReadOnly: CalledOnce = { kind: 'unopened', refused: 'tool_not_read_only', mark: 'acts', detail: '' };

export const assetNotSent: CalledOnce = {
  kind: 'unopened',
  refused: 'asset_not_sent',
  because: 'asset_unusable',
  pointer: '/file',
  detail: '',
};

export function answeredSecretOf({ secret }: Subscribed): string | undefined {
  return secret === undefined || secret === 'made' ? undefined : Redacted.value(secret.answered);
}

export function requestedWith(document: Schema.Json): RequestedOnce {
  return { kind: 'answered', outcome: 'result', answer: document };
}

export function sentWith(service: FakeService): readonly unknown[] {
  return service.sent().map((sent) => ('tool' in sent ? sent.tool.input : sent.request));
}

function inTurn<Answer>(answers: readonly Answer[], asked: number): Answer {
  return Option.getOrThrow(Option.fromNullishOr(answers[Math.min(asked, answers.length) - 1]));
}

function serviceOf(called: readonly CalledOnce[], requested: readonly RequestedOnce[], serving: Serving): FakeService {
  const sent: Sent[] = [];
  const asked: (readonly [SubscriptionPlace, Receiving])[] = [];
  const { callbacks = { webhook: theCallback, queue: theQueue }, mostRequestBytes = 1_048_576 } = serving;
  const sentBy = (way: 'tool' | 'request') => sent.filter((each) => way in each).length;
  return {
    ports: {
      callOnce: (call) =>
        Effect.sync(() => {
          sent.push({ tool: call });
          return inTurn(called, sentBy('tool'));
        }),
      requestOnce: (request) =>
        Effect.sync(() => {
          sent.push({ request });
          return inTurn(requested, sentBy('request'));
        }),
      mostRequestBytesTo: () => mostRequestBytes,
      callbackOf: (where, type) => {
        asked.push([where, type]);
        return callbacks[type];
      },
    },
    sent: () => sent,
    callbacksAsked: () => asked,
  };
}

export function aService(answers: readonly CalledOnce[], serving: Serving = {}): FakeService {
  return serviceOf(answers, [], serving);
}

export function aServiceAnsweringRequests(answers: readonly RequestedOnce[], serving: Serving = {}): FakeService {
  return serviceOf([], answers, serving);
}
