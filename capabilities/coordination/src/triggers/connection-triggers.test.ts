import type { JsonObject } from '@on.auto/workflow-engine';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeWorkflowAdapter } from '../capability/workflow.ts';
import { connectionsReporting } from '../testing/connection-events.ts';
import { testExpressionCheck } from '../testing/expression-checks.ts';
import { noneQueued } from '../testing/playbook.ts';
import { testPlaybookNames } from '../testing/test-sandbox.ts';
import type { ConnectionReporting, Hearing } from './connection-ports.ts';
import { connectionRejectionsOf, connectionTriggersChecked } from './connection-triggers.ts';

const place = { org: 'acme', playbook: 'alpha', name: 'on-items' };

const added = { type: 'com.example.item.added', title: 'An item is added' };

const closed = {
  type: 'com.example.board.closed',
  title: 'A board is closed',
  subject: { title: 'Board', required: true },
};

const removed = { type: 'com.example.item.removed', title: 'An item is removed' };

const renamed = { type: 'com.example.item.renamed', title: 'An item is renamed' };

const posted = {
  type: 'com.example.chat.post',
  title: 'A post is made',
  subject: { title: 'Room', required: true },
};

const subscribed = new Set([closed.type, renamed.type]);

function hearingOf(type: string, subject: string | undefined): Hearing {
  if (type === removed.type) {
    return { kind: 'not_heard' };
  }
  if (type === posted.type) {
    return { kind: 'lacking', label: 'Chat app-level token' };
  }
  const topic = (subject ?? 'every board').toLowerCase();
  return subscribed.has(type) ? { kind: 'heard', subscribes: { topic, mostTopics: 2 } } : { kind: 'heard' };
}

const tracker: ConnectionReporting = {
  status: 'connected',
  types: [added, closed, removed, renamed, posted],
  hearing: (type, subject) => Effect.succeed(hearingOf(type, subject)),
  reading: () => Effect.die('a read was asked'),
  tools: Effect.die('the tools were listed'),
  listenedBy: [],
};

const shared: ConnectionReporting = {
  ...tracker,
  listenedBy: [
    { workflow: 'on-boards', type: closed.type, subject: 'West' },
    { workflow: 'on-boards', type: added.type },
    { workflow: 'on-boards', type: removed.type },
    { workflow: 'on-items', type: closed.type, subject: 'Gone' },
  ],
};

const reporting = {
  tracker,
  shared,
  mended: { ...tracker, status: 'broken' },
  waiting: { ...tracker, status: 'pending' },
  silent: { ...tracker, types: [] },
  checked: {
    ...tracker,
    reading: () => Effect.succeed({ kind: 'heard' }),
    listenedBy: [
      {
        workflow: 'on-reads',
        type: added.type,
        read: { tool: 'list_items', list: '', order: 'oldest_first', id: ['/id'] },
      },
    ],
  },
} satisfies Readonly<Record<string, ConnectionReporting>>;

function filter(source: string, type: string, subject?: string): JsonObject {
  return { with: { type, source, ...(subject === undefined ? {} : { subject }) } };
}

function workflowOn(
  filters: readonly JsonObject[],
  steps: readonly JsonObject[] = [],
): Parameters<typeof connectionRejectionsOf>[1] {
  return {
    document: { schedule: { on: { any: [...filters] } }, do: [...steps] },
    locate: () => ({ line: 7, column: 9 }),
  };
}

async function refusedAt(filters: readonly JsonObject[], connections = connectionsReporting(reporting)) {
  const rejections = await Effect.runPromise(connectionRejectionsOf(connections, workflowOn(filters), place));
  return rejections.map(({ pointer }) => pointer);
}

const eachWayRefused = [
  filter('/connections/nowhere', added.type),
  filter('/connections/tracker', 'com.example.item.moved'),
  filter('/connections/tracker', removed.type),
  filter('/connections/mended', added.type),
  filter('/connections/tracker', closed.type),
  filter('/connections/silent', added.type),
  filter('/connections/waiting', added.type),
  filter('/connections/tracker', posted.type, 'lobby'),
  filter('/ledger/eu', added.type),
  filter('/connections/tracker', added.type),
  { with: { type: added.type } },
];

const refusedPlaces = [
  '/schedule/on/any/0/with/source',
  '/schedule/on/any/1/with/type',
  '/schedule/on/any/2/with/type',
  '/schedule/on/any/3/with/source',
  '/schedule/on/any/4/with',
  '/schedule/on/any/5/with/type',
  '/schedule/on/any/6/with/source',
  '/schedule/on/any/7/with/source',
];

describe('a trigger that names a connection, checked when its workflow is saved', () => {
  it('is refused at the place of the filter for each way the connection cannot start it, and asks each connection once', async () => {
    const connections = connectionsReporting(reporting);

    expect(await refusedAt(eachWayRefused, connections)).toEqual(refusedPlaces);
    expect(connections.asked()).toEqual([
      'alpha/nowhere',
      'alpha/tracker',
      'alpha/mended',
      'alpha/silent',
      'alpha/waiting',
    ]);
  });
});

describe('a trigger with no read under a type another workflow checks a read under, through the same connection', () => {
  it('is refused at its type', async () => {
    expect(await refusedAt([filter('/connections/checked', added.type)])).toEqual(['/schedule/on/any/0/with/type']);
  });
});

describe('the refusals of a trigger that names a connection', () => {
  it.each([
    [
      'a pending connection, before the type it does not report',
      filter('/connections/waiting', 'com.example.x'),
      '/with/source',
    ],
    [
      'a type the connection does not report, before whether it is heard',
      filter('/connections/mended', 'com.example.x'),
      '/with/type',
    ],
    ['a credential it lacks, before a place left out', filter('/connections/tracker', posted.type), '/with/source'],
    ['a type not heard here, before a broken connection', filter('/connections/mended', removed.type), '/with/type'],
    ['a broken connection, before a place left out', filter('/connections/mended', closed.type), '/with/source'],
  ])('refuses %s', async (_case, refused, at) => {
    expect(await refusedAt([refused])).toEqual([`/schedule/on/any/0${at}`]);
  });
});

describe('a trigger the connection can start', () => {
  it('is taken where the connection reports the event and this runtime hears it, and nothing is asked for a workflow that names none', async () => {
    const connections = connectionsReporting(reporting);

    expect(
      await refusedAt(
        [filter('/connections/tracker', closed.type, 'North'), filter('/connections/tracker', added.type)],
        connections,
      ),
    ).toEqual([]);
    expect(await refusedAt([filter('/ledger/eu', added.type)], connections)).toEqual([]);
    expect(connections.asked()).toEqual(['alpha/tracker']);
  });

  it('refuses the save as the document is refused, each problem on its line and at its place', async () => {
    const checked = connectionTriggersChecked(connectionsReporting(reporting));
    const nowhere = workflowOn([filter('/connections/nowhere', added.type)]);

    const refused = await Effect.runPromise(Effect.flip(checked(nowhere, place)));
    const accepted = await Effect.runPromiseExit(checked(workflowOn([]), place));

    const onItsLine: unknown = expect.stringMatching(/^Line 7, column 9: at \/schedule\/on\/any\/0\/with\/source: /u);
    expect(refused).toMatchObject({ issues: [{ detail: onItsLine }] });
    expect(Exit.isSuccess(accepted)).toBe(true);
  });
});

function listeningTo(source: string): JsonObject {
  return { wait: { listen: { to: { one: { with: { type: added.type, source } } } } } };
}

describe('a step that waits for an event of a connection', () => {
  it('is refused at its listen, where its source is written out as a connection’s, and asks no connection', async () => {
    const connections = connectionsReporting(reporting);
    const steps = [
      listeningTo('/connections/tracker'),
      listeningTo('/ledger/eu'),
      { note: { set: { seen: true } } },
      listeningTo('/connections/nowhere'),
    ];

    const rejections = await Effect.runPromise(connectionRejectionsOf(connections, workflowOn([], steps), place));

    expect(rejections.map(({ pointer }) => pointer)).toEqual(['/do/0/wait/listen/to', '/do/3/wait/listen/to']);
    expect(connections.asked()).toEqual([]);
  });
});

describe('a subject a filter that names a connection writes as an expression', () => {
  it('is refused by the engine when the workflow is read, before any connection is asked', async () => {
    const connections = connectionsReporting(reporting);
    const workflow = makeWorkflowAdapter({
      runs: { start: () => Effect.die('a run was started') },
      queued: noneQueued,
      check: testExpressionCheck,
      connectionEvents: connections,
      mostDurationMs: 2_592_000_000,
      longestCallMs: 1000,
      names: testPlaybookNames,
    });
    const on =
      "schedule:\n  on: { one: { with: { type: com.example.board.closed, source: /connections/tracker, subject: '${ $data.board }' } } }\n";
    const source = `document: { dsl: '1.0.3', namespace: acme, name: flow, version: '1.0.0' }\n${on}do:\n  - note: { set: { a: 1 } }\n`;

    const refused = await Effect.runPromise(Effect.flip(workflow.prepare(source)));

    expect(refused.issues.map(({ detail }) => detail)).toEqual([
      expect.stringContaining('/schedule/on/one/with/subject'),
    ]);
    expect(connections.asked()).toEqual([]);
  });
});

describe('the places a playbook’s triggers listen in through one connection', () => {
  it('are refused past the most one connection holds for the playbook, at each filter that adds one', async () => {
    expect(
      await refusedAt([
        filter('/connections/tracker', closed.type, 'North'),
        filter('/connections/tracker', closed.type, 'South'),
        filter('/connections/tracker', renamed.type, 'north'),
        filter('/connections/tracker', closed.type, 'East'),
        filter('/connections/tracker', renamed.type),
        filter('/connections/tracker', added.type, 'West'),
      ]),
    ).toEqual(['/schedule/on/any/3/with/subject', '/schedule/on/any/4/with']);
  });

  it('count those the playbook’s other workflows listen in, and leave out the earlier version of the workflow saved', async () => {
    expect(
      await refusedAt([
        filter('/connections/shared', closed.type, 'west'),
        filter('/connections/shared', closed.type, 'North'),
        filter('/connections/shared', closed.type, 'South'),
      ]),
    ).toEqual(['/schedule/on/any/2/with/subject']);
  });
});
