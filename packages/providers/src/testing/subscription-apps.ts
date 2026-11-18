import type { CalledOnce, ConnectionRequest, OneCall, RequestedOnce } from '@on.auto/tool-servers';
import { Effect, Option, type Schema } from 'effect';

import type { Destination } from '../events/destination-fields.ts';
import type { ThroughTheConnection } from '../subscriptions/subscription-ports.ts';
import { ofEachSubscription } from './event-destinations.ts';
import { providerOf, tracker } from './fixture-providers.ts';
import {
  answeredWith,
  notOfferedAs,
  refusedByTheTool,
  requestedWith,
  serverFailureAs,
} from './subscription-services.ts';

export function declaredDestinations(...written: readonly object[]): readonly Destination[] {
  const { entry } = providerOf({ ...tracker, events: { destinations: written } });
  return Option.getOrThrow(Option.fromNullishOr(entry.events)).destinations;
}

export const leasedWithoutRenewal = { ...ofEachSubscription, lease_seconds: 3600 };

export const answeringItsSecret = {
  type: 'webhook',
  per: 'subscription',
  topic: '{{ with.board }}',
  subscribe: {
    tool: 'create_webhook',
    with: { board: '{{ topic }}', callback: '{{ webhook_url }}', seconds: '{{ lease.seconds }}' },
    subscribed: { id: '/webhook/id', secret: '/webhook/signing_key' },
  },
  unsubscribe: { tool: 'delete_webhook', with: { id: '{{ subscription.id }}', board: '{{ topic }}' } },
  lease_seconds: 3600,
  verify: { scheme: 'bearer', secret: 'subscription', token: '$request.header.X-Board-Token' },
  filter: { when: { '$request.header.X-Board-Event': ['card'] }, subscription: '$request.header.X-Board-Hook' },
};

export type Failing = 'connection_broken' | 'scope_lacking' | 'tool_error' | 'unreachable';

const failedRequests: Readonly<Record<Failing, RequestedOnce>> = {
  connection_broken: { kind: 'unopened', because: 'connection_broken' },
  scope_lacking: { kind: 'answered', outcome: 'server_failure', because: 'scope_lacking' },
  tool_error: { kind: 'answered', outcome: 'tool_error' },
  unreachable: { kind: 'answered', outcome: 'server_failure', because: 'unreachable' },
};

const failedCalls: Readonly<Record<Failing, CalledOnce>> = {
  connection_broken: notOfferedAs('connection_broken'),
  scope_lacking: serverFailureAs('scope_lacking'),
  tool_error: refusedByTheTool(''),
  unreachable: serverFailureAs('unreachable'),
};

interface AtTheApp {
  readonly id: string;
  readonly target: string;
  readonly secret: string;
}

type Act = 'subscribe' | 'renew' | 'unsubscribe';

export interface AppAnswering {
  readonly reusesIds?: boolean;
  readonly reusesSecrets?: boolean;
  readonly mostRequestBytes?: number;
}

export interface FakeApp {
  readonly through: ThroughTheConnection;
  readonly held: () => readonly AtTheApp[];
  readonly acts: () => readonly Act[];
  readonly fails: (failing: Failing, times: number) => void;
}

interface Asked {
  readonly act: Act;
  readonly target: string;
  readonly id: string;
  readonly lease: string | null;
}

function actOf(tool: string): Act {
  if (tool.startsWith('create_')) {
    return 'subscribe';
  }
  return tool.startsWith('update_') ? 'renew' : 'unsubscribe';
}

function textIn(input: Readonly<Record<string, unknown>>, name: string): string | null {
  const value = input[name];
  return typeof value === 'string' ? value : null;
}

function toolAsked({ reference, input }: OneCall): Asked {
  const target = `${textIn(input, 'resource') ?? ''}${textIn(input, 'board') ?? ''}`;
  const lease = textIn(input, 'expirationDateTime');
  return { act: actOf(reference.tool), target, id: textIn(input, 'id') ?? '', lease };
}

function requestAsked({ method, url }: ConnectionRequest): Asked {
  const id = url.slice(url.lastIndexOf('/') + 1);
  return { act: method === 'DELETE' ? 'unsubscribe' : 'subscribe', target: url, id, lease: null };
}

export function anApp(answering: AppAnswering = {}): FakeApp {
  const held = new Map<string, AtTheApp>();
  const acts: Act[] = [];
  const failing: Failing[] = [];
  const made: string[] = [];
  const subscribed = (target: string): AtTheApp => {
    const same = [...held.values()].find((each) => each.target === target);
    made.push(target);
    const id = answering.reusesIds === true && same !== undefined ? same.id : `hook-${made.length}`;
    const secret =
      answering.reusesSecrets === true && same !== undefined ? same.secret : `app-secret-${made.length}-c41d8e`;
    return { id, target, secret };
  };
  const answered = ({ act, target, id, lease }: Asked): Schema.Json => {
    if (act !== 'subscribe') {
      held.delete(act === 'unsubscribe' ? id : '');
      return { expirationDateTime: lease };
    }
    const subscription = subscribed(target);
    held.set(subscription.id, subscription);
    const { id: madeId, secret } = subscription;
    return { id: madeId, expirationDateTime: lease, webhook: { id: madeId, signing_key: secret } };
  };
  const failed = (asked: Asked): Failing | undefined => {
    acts.push(asked.act);
    return failing.shift();
  };
  return {
    through: {
      callOnce: (call) =>
        Effect.sync(() => {
          const asked = toolAsked(call);
          const failure = failed(asked);
          return failure === undefined ? answeredWith(answered(asked)) : failedCalls[failure];
        }),
      requestOnce: (request) =>
        Effect.sync(() => {
          const asked = requestAsked(request);
          const failure = failed(asked);
          return failure === undefined ? requestedWith(answered(asked)) : failedRequests[failure];
        }),
      mostRequestBytesTo: () => answering.mostRequestBytes ?? 1_048_576,
    },
    held: () => [...held.values()],
    acts: () => acts,
    fails: (failure, times) => {
      failing.push(...Array.from({ length: times }, () => failure));
    },
  };
}
