import { generationOf, isArranging, type EventDestination, type RecordedSubscription } from '@on.auto/providers';
import { overTheBoardsSocket } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { boardsSentBy, bySubscription, byTheApp } from '../testing/boards-reported.ts';
import type { Hearing } from './connection-hearing.ts';
import {
  triggerStandingOf,
  type ConnectionAsRecorded,
  type Subscribed,
  type TriggerRecords,
} from './trigger-standing.ts';

function destinationOf(sent: object): EventDestination {
  const [destination] = boardsSentBy(sent).events?.destinations ?? [];
  if (destination === undefined) {
    throw new Error('The entry sends nothing');
  }
  return destination;
}

const subscribing = destinationOf(bySubscription);

const routing = destinationOf(byTheApp);

const overASocket = destinationOf(overTheBoardsSocket);

const connectedAt = '2026-11-22T08:00:00.000Z';

const generation = isArranging(subscribing) ? generationOf(connectedAt, subscribing) : { declared: '' };

const earlier = { connected: '2026-11-21T08:00:00.000Z', declared: generation.declared };

const connected: ConnectionAsRecorded = { status: 'connected', accountRecorded: true, identified: true };

const heard = (destination: EventDestination): Hearing => ({ kind: 'heard', destination });

const key = { connection: 'boards', topic: 'board-7' };

function subscribed(recorded?: Omit<RecordedSubscription, 'connection' | 'topic'>): Subscribed {
  return { topic: key.topic, recorded: recorded === undefined ? undefined : { ...key, ...recorded }, generation };
}

const made = { made: { type: 'webhook', id: 'hook-1', declared: generation.declared } } as const;

const listeningThroughASubscription: TriggerRecords = {
  connection: 'boards',
  paused: false,
  recorded: connected,
  hearing: heard(subscribing),
  actorDeclared: true,
  subscribed: subscribed(made),
};

function failed(
  kind: 'connection_broken' | 'scope_lacking' | 'tool_error' | 'unreachable' | 'not_sent',
  attempted = generation,
): Omit<RecordedSubscription, 'connection' | 'topic'> {
  const because = kind === 'connection_broken' ? 'key_refused' : kind;
  return { ...made, failed: { kind, because, attempted } };
}

const rows: readonly (readonly [string, Partial<TriggerRecords>, string, boolean])[] = [
  ['a paused workflow', { paused: true }, 'workflow_paused', false],
  ['a connection gone', { recorded: undefined }, 'connection_gone', false],
  ['a pending connection', { recorded: { ...connected, status: 'pending' } }, 'connection_pending', false],
  ['a broken connection', { recorded: { ...connected, status: 'broken' } }, 'connection_broken', true],
  ['an event not received here', { hearing: { kind: 'not_heard' } }, 'not_received_here', false],
  [
    'an app credential lacking',
    { hearing: { kind: 'lacking', label: 'Chat app-level token' } },
    'app_credential_needed',
    true,
  ],
  ['an identity not recorded', { recorded: { ...connected, identified: false } }, 'account_not_recorded', false],
  [
    'an account not recorded, for the app’s one address',
    { hearing: heard(routing), recorded: { ...connected, accountRecorded: false }, subscribed: undefined },
    'account_not_recorded',
    false,
  ],
  ['no subscription yet', { subscribed: subscribed() }, 'setting_up', false],
  [
    'a subscription of an older declaration',
    { subscribed: subscribed({ made: { ...made.made, declared: 'older' } }) },
    'setting_up',
    false,
  ],
  [
    'a lasting failure of an earlier connecting',
    { subscribed: subscribed(failed('tool_error', earlier)) },
    'setting_up',
    false,
  ],
  [
    'a subscription refused as the connection is broken',
    { subscribed: subscribed(failed('connection_broken')) },
    'connection_broken',
    true,
  ],
  ['access the account lacks', { subscribed: subscribed(failed('scope_lacking')) }, 'access_lacking', true],
  ['a request the service refused', { subscribed: subscribed(failed('tool_error')) }, 'request_failed', true],
  ['a service not answering', { subscribed: subscribed(failed('unreachable')) }, 'service_not_answering', false],
  ['too many places', { subscribed: subscribed(failed('not_sent')) }, 'too_many_places', false],
];

describe('how a trigger that starts from a connection stands, read from what the records hold', () => {
  it.each(rows)(
    'is not listening for %s, with its kind and whether only a reconnect mends it',
    (_case, records, kind, needs) => {
      const stood = triggerStandingOf({ ...listeningThroughASubscription, ...records });

      const inWords: unknown = expect.any(String);
      expect(stood).toEqual({ listening: false, kind, detail: inWords, needsReconnecting: needs });
    },
  );

  it.each([
    ['through a subscription made as declared', {}],
    ['through the app’s one address, its account recorded', { hearing: heard(routing), subscribed: undefined }],
    [
      'over a socket, of an event that names no actor',
      {
        hearing: heard(overASocket),
        subscribed: undefined,
        actorDeclared: false,
        recorded: { ...connected, identified: false },
      },
    ],
  ])('is listening %s', (_case, records: Partial<TriggerRecords>) => {
    expect(triggerStandingOf({ ...listeningThroughASubscription, ...records })).toEqual({ listening: true });
  });

  it('names the place and the app credential it is about, where it is about one', () => {
    const lacking = triggerStandingOf({
      ...listeningThroughASubscription,
      hearing: { kind: 'lacking', label: 'Chat app-level token' },
    });
    const refused = triggerStandingOf({
      ...listeningThroughASubscription,
      subscribed: subscribed(failed('tool_error')),
    });

    const namingTheCredential: unknown = expect.stringContaining('Chat app-level token');
    const namingThePlace: unknown = expect.stringContaining(key.topic);
    expect([lacking, refused]).toMatchObject([{ detail: namingTheCredential }, { detail: namingThePlace }]);
  });
});
