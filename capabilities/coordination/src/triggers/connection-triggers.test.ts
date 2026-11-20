import type { JsonObject } from '@on.auto/workflow-engine';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ReadWorkflow } from '../document/workflow-document.ts';
import { connectionsReporting } from '../testing/connection-events.ts';
import {
  connectionRejectionsOf,
  connectionTriggersChecked,
  type ConnectionReporting,
  type Hearing,
} from './connection-triggers.ts';

const place = { org: 'acme', playbook: 'alpha', name: 'on-items' };

const added = { type: 'com.example.item.added', title: 'An item is added' };

const closed = {
  type: 'com.example.board.closed',
  title: 'A board is closed',
  subject: { title: 'Board', required: true },
};

const removed = { type: 'com.example.item.removed', title: 'An item is removed' };

const renamed = { type: 'com.example.item.renamed', title: 'An item is renamed' };

const subscribed = new Set([closed.type, renamed.type]);

function hearingOf(type: string, subject: string | undefined): Hearing {
  const topic = (subject ?? 'every board').toLowerCase();
  return subscribed.has(type) ? { subscribes: { topic, mostTopics: 2 } } : {};
}

const tracker: ConnectionReporting = {
  broken: false,
  types: [added, closed, removed, renamed],
  heard: (type, subject) => (type === removed.type ? undefined : hearingOf(type, subject)),
  listenedBy: [],
};

const shared: ConnectionReporting = {
  ...tracker,
  listenedBy: [
    { workflow: 'on-boards', type: closed.type, subject: 'West' },
    { workflow: 'on-boards', type: added.type },
    { workflow: 'on-items', type: closed.type, subject: 'Gone' },
  ],
};

const reporting = { tracker, shared, mended: { ...tracker, broken: true }, silent: { ...tracker, types: [] } };

function filter(source: string, type: string, subject?: string): JsonObject {
  return { with: { type, source, ...(subject === undefined ? {} : { subject }) } };
}

function workflowOn(filters: readonly JsonObject[]): ReadWorkflow {
  return { document: { schedule: { on: { any: [...filters] } }, do: [] }, locate: () => ({ line: 7, column: 9 }) };
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
];

describe('a trigger that names a connection, checked when its workflow is saved', () => {
  it('is refused at the place of the filter for each way the connection cannot start it, and asks each connection once', async () => {
    const connections = connectionsReporting(reporting);

    expect(await refusedAt(eachWayRefused, connections)).toEqual(refusedPlaces);
    expect(connections.asked()).toEqual(['alpha/nowhere', 'alpha/tracker', 'alpha/mended', 'alpha/silent']);
  });

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

    expect(refused.issues.map(({ detail }) => detail)).toEqual([
      expect.stringMatching(/^Line 7, column 9: at \/schedule\/on\/any\/0\/with\/source: /u),
    ]);
    expect(Exit.isSuccess(accepted)).toBe(true);
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
