import {
  generationOf,
  isArranging,
  type EventDestination,
  type Generation,
  type RecordedFailure,
  type RecordedSubscription,
} from '@on.auto/providers';
import { overTheBoardsSocket } from '@on.auto/providers/testing';
import { describe, expect, it } from 'vitest';

import { boardsSentBy, byChecking, bySubscription, byTheApp } from '../testing/boards-reported.ts';
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

const checking = destinationOf(byChecking);

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

type FailureKind = 'connection_broken' | 'scope_lacking' | 'tool_error' | 'unreachable' | 'not_sent';

function failureOf(kind: FailureKind, attempted: Generation = generation): RecordedFailure {
  const because = kind === 'connection_broken' ? 'key_refused' : kind;
  return { kind, because, attempted };
}

function failed(kind: FailureKind, attempted = generation): Omit<RecordedSubscription, 'connection' | 'topic'> {
  return { ...made, failed: failureOf(kind, attempted) };
}

const madeByChecking = { made: { type: 'polling', declared: generation.declared, since: connectedAt } } as const;

function checked(kind: FailureKind, failures?: number, attempted: Generation = generation): Subscribed {
  const positions = failures === undefined ? {} : { positions: { failures } };
  return subscribed({ ...madeByChecking, failed: failureOf(kind, attempted), ...positions });
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
  [
    'a request the service refused, whatever the count of failures in a row',
    { subscribed: subscribed({ ...failed('tool_error'), positions: { failures: 0 } }) },
    'request_failed',
    true,
  ],
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

describe('how a trigger of an app Auto checks stands', () => {
  it.each([
    ['a broken connection', { recorded: { ...connected, status: 'broken' } }, 'connection_broken', true],
    ['its first check under way', { subscribed: subscribed() }, 'setting_up', false],
    ['a check the service refused', { subscribed: subscribed(failed('tool_error')) }, 'request_failed', true],
    ['a paused workflow', { paused: true }, 'workflow_paused', false],
    [
      'its first check refused, held until a reconnect or a changed entry',
      { subscribed: subscribed({ failed: failureOf('tool_error'), positions: { failures: 0 } }) },
      'request_failed',
      true,
    ],
    [
      'its first check unanswered, tried again',
      { subscribed: subscribed({ failed: failureOf('unreachable'), positions: { failures: 1 } }) },
      'service_not_answering',
      false,
    ],
    [
      'its first check past the most places one connection holds',
      { subscribed: subscribed({ failed: { kind: 'not_sent', because: 'not_sent' } }) },
      'too_many_places',
      false,
    ],
  ] as const)(
    'is not listening for %s, with the kind an instant trigger has',
    (_case, records: Partial<TriggerRecords>, kind, needs) => {
      const stood = triggerStandingOf({ ...listeningThroughASubscription, hearing: heard(checking), ...records });

      const inWords: unknown = expect.any(String);
      expect(stood).toEqual({ listening: false, kind, detail: inWords, needsReconnecting: needs });
    },
  );
});

function standingOf(recorded: Subscribed) {
  return triggerStandingOf({ ...listeningThroughASubscription, hearing: heard(checking), subscribed: recorded });
}

describe('how a trigger of an app Auto checks stands once a check is made, by whether its check fails now', () => {
  it.each([
    ['a refused read tried again that worked', checked('tool_error', 0)],
    ['an unanswered read tried again that worked', checked('unreachable', 0)],
    ['a broken connection reconnected, before its first read', checked('connection_broken', 0, earlier)],
    ['access it lacked, reconnected, before its first read', checked('scope_lacking', 0, earlier)],
    ['a call that could not be written, reconnected, before its first read', checked('not_sent', 0, earlier)],
    ['a refused read, reconnected, after a first read that worked', checked('tool_error', 0, earlier)],
    ['a refused read, rebuilt with no count of failures in a row', checked('tool_error')],
    ['an unanswered read, rebuilt with no count of failures in a row', checked('unreachable')],
  ])('is listening after %s', (_case, recorded) => {
    expect(standingOf(recorded)).toEqual({ listening: true });
  });

  it.each([
    ['a refused read still failing', checked('tool_error', 2), 'request_failed', true],
    ['an unanswered read still failing', checked('unreachable', 2), 'service_not_answering', false],
    ['a broken connection, held', checked('connection_broken', 0), 'connection_broken', true],
    ['access it lacks, held', checked('scope_lacking', 0), 'access_lacking', true],
    ['a call that cannot be written, held', checked('not_sent', 0), 'too_many_places', false],
    ['a held failure, rebuilt with no count of failures in a row', checked('scope_lacking'), 'access_lacking', true],
    [
      'a refused read, reconnected, before the read tried again',
      checked('tool_error', 1, earlier),
      'setting_up',
      false,
    ],
    [
      'a refused read, reconnected, after a first read that failed again',
      checked('tool_error', 1),
      'request_failed',
      true,
    ],
  ] as const)(
    'is not listening for %s, with its kind and whether only a reconnect mends it',
    (_case, recorded, kind, needs) => {
      const inWords: unknown = expect.any(String);
      expect(standingOf(recorded)).toEqual({ listening: false, kind, detail: inWords, needsReconnecting: needs });
    },
  );
});
