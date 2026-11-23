import type { StandingRequest, Trigger } from '@on.auto/definitions';
import type { Outcome } from '@on.auto/operations';
import { Effect } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectionsReporting } from '../testing/connection-events.ts';
import { workflowPlaybook, type WorkflowPlaybook } from '../testing/workflow-playbook.ts';
import type { ConnectionReporting, StandingAsked, TriggerStanding } from './connection-triggers.ts';
import { triggersStandingOf } from './trigger-standings.ts';

const opened = 'com.example.ticket.opened';

const ofTheTracker = (reference: string, attributes: Readonly<Record<string, string | boolean>>) => ({
  reference,
  type: opened,
  attributes: { type: opened, ...attributes },
});

const listening: readonly Trigger[] = [
  {
    kind: 'event',
    reference: '/schedule/on',
    filters: [
      ofTheTracker('/schedule/on/any/0', { source: '/connections/tracker', subject: 'board-7' }),
      ofTheTracker('/schedule/on/any/1', { source: '/connections/notes' }),
      ofTheTracker('/schedule/on/any/2', { source: '/ledger/eu' }),
    ],
  },
  { kind: 'every', reference: '/schedule/every', milliseconds: 60_000 },
];

const request: StandingRequest = {
  org: 'acme',
  playbook: 'alpha',
  definition: 'on-tickets-id',
  name: 'on-tickets',
  version: 1,
  status: 'active',
  triggers: listening,
};

function standingOf({ connection, paused }: StandingAsked): TriggerStanding {
  if (paused) {
    return {
      event: 'A ticket is opened',
      speed: 'instant',
      listening: false,
      notListeningBecause: { kind: 'workflow_paused', detail: 'paused' },
      needsReconnecting: false,
    };
  }
  return connection === 'tracker'
    ? {
        event: 'A ticket is opened',
        subjectName: '#triage',
        speed: 'polling',
        pollingIntervalSeconds: 60,
        listening: true,
        notListeningBecause: null,
        needsReconnecting: false,
      }
    : {
        speed: 'instant',
        listening: false,
        notListeningBecause: { kind: 'connection_gone', detail: 'gone' },
        needsReconnecting: false,
      };
}

const tracker: ConnectionReporting = {
  status: 'connected',
  types: [{ type: opened, title: 'A ticket is opened' }],
  hearing: () => Effect.succeed({ kind: 'heard' }),
  listenedBy: [],
};

function askedOf() {
  const asked: StandingAsked[] = [];
  const events = connectionsReporting({ tracker }, (each) => {
    asked.push(each);
    return standingOf(each);
  });
  return { events, asked };
}

const listeningOnTheTracker = {
  reference: '/schedule/on/any/0',
  connection: 'tracker',
  event: 'A ticket is opened',
  subject_name: '#triage',
  speed: 'polling',
  polling_interval_seconds: 60,
  listening: true,
  not_listening_because: null,
  needs_reconnecting: false,
};

const goneFromTheNotes = {
  reference: '/schedule/on/any/1',
  connection: 'notes',
  speed: 'instant',
  listening: false,
  not_listening_because: { kind: 'connection_gone', detail: 'gone' },
  needs_reconnecting: false,
};

describe('how a workflow’s triggers that start from a connection stand', () => {
  it('is one entry for each filter that names a connection, as the connection’s port reads it, with the place each names and its name where the port holds one', async () => {
    const { events, asked } = askedOf();

    const stood = await Effect.runPromise(triggersStandingOf(events)(request));

    expect(stood).toEqual([listeningOnTheTracker, goneFromTheNotes]);
    expect(stood?.map((entry) => 'subject_name' in entry)).toEqual([true, false]);
    expect(asked).toEqual([
      { connection: 'tracker', type: opened, subject: 'board-7', paused: false },
      { connection: 'notes', type: opened, paused: false },
    ]);
  });

  it('reads as listening where the port says so', async () => {
    const stood = await Effect.runPromise(triggersStandingOf(connectionsReporting({ tracker }))(request));

    expect(stood?.map(({ listening: heard }) => heard)).toEqual([true, true]);
  });

  it('asks as paused for a paused workflow, and is left out for a retired one, one with no such filter or none at all', async () => {
    const { events, asked } = askedOf();
    const standing = triggersStandingOf(events);
    const { triggers: _left, ...withoutTriggers } = request;

    const stood = await Effect.runPromise(
      Effect.all([
        standing({ ...request, status: 'paused' }),
        standing({ ...request, status: 'retired' }),
        standing({ ...request, triggers: listening.slice(1) }),
        standing(withoutTriggers),
      ]),
    );

    const paused = { kind: 'workflow_paused', detail: 'paused' };
    expect(stood.map((each) => each?.map(({ not_listening_because: because }) => because))).toEqual([
      [paused, paused],
      undefined,
      undefined,
      undefined,
    ]);
    expect(asked.map(({ paused: asPaused }) => asPaused)).toEqual([true, true]);
  });
});

const tracking = {
  reference: '/schedule/on/any/0',
  connection: 'tracker',
  event: 'A ticket is opened',
  subject_name: '#triage',
} as const;

const standingOfOne = {
  ...tracking,
  speed: 'polling',
  polling_interval_seconds: 60,
  listening: true,
  not_listening_because: null,
  needs_reconnecting: false,
} as const;

let playbook: WorkflowPlaybook;

function standingIn(outcome: Outcome): unknown {
  return outcome.status === 'succeeded' ? outcome.output['standing'] : undefined;
}

const header = "document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\n";

const onATicket = `${header}schedule:\n  on: { one: { with: { type: ${opened}, source: /connections/tracker, subject: board-7 } } }\ndo:\n  - noted: { set: { seen: true } }\n`;

const onEveryMinute = `${header}schedule:\n  every: PT1M\ndo:\n  - noted: { set: { seen: true } }\n`;

beforeAll(async () => {
  playbook = await workflowPlaybook({ connectionEvents: askedOf().events });
});

afterAll(async () => {
  await playbook.close();
});

describe('a workflow saved with a trigger that starts from a connection', () => {
  it('is answered, and read, with how each such trigger stands, and one with no such trigger without it', async () => {
    const saved = await playbook.call(playbook.createDefinition, {
      type: 'workflow',
      name: 'on-a-ticket',
      source: onATicket,
    });
    await playbook.call(playbook.createDefinition, { type: 'workflow', name: 'each-minute', source: onEveryMinute });
    const read = await playbook.call(playbook.getDefinition, { type: 'workflow', name: 'on-a-ticket' });
    const timed = await playbook.call(playbook.getDefinition, { type: 'workflow', name: 'each-minute' });

    const stood = {
      queued: 0,
      next_queued_start: null,
      triggers: [{ ...standingOfOne, reference: '/schedule/on/one' }],
    };
    expect(saved).toMatchObject({ status: 'succeeded', output: { standing: stood } });
    expect(read).toMatchObject({ status: 'succeeded', output: { standing: stood } });
    expect(timed).toMatchObject({ status: 'succeeded', output: { standing: { queued: 0, next_queued_start: null } } });
    expect(standingIn(timed)).not.toHaveProperty('triggers');
  });
});
