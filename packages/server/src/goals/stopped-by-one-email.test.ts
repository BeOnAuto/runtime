import { assessmentIdOf, GoalsReadSchema, noAssessments, type Assessments } from '@on.auto/goals';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { savedWorkflow } from '../testing/goals/assessed-runs.ts';
import {
  movingUntil,
  servedWatched,
  type GoalsPortsTurned,
  type WatchedServer,
} from '../testing/goals/watched-goals.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { createdWithGoals } from '../testing/settings/goals-kept.ts';

const goals = [
  '- id: orders',
  '  name: Wholesale orders',
  '  statement: Every wholesale order is decided within a day of arriving.',
  '  per: order',
  '  window: { after: arrived, for: P1D }',
  '  success:',
  '    label: Orders decided',
  '    settles: on_crossing',
  '    target: { at_least: 1 }',
  '    passed: Decided',
  '    failed: Not decided in time',
  '  milestones:',
  '    - { id: arrived, label: Order arrived, by: auto }',
  '    - { id: priced, label: Order priced, by: auto }',
  '    - { id: decided, label: Decided, by: person }',
  '  notify: { passed: quiet, failed: quiet, overdue: quiet }',
  '',
].join('\n');

const decideOrder = [
  '---',
  'description: Ask the owner to accept or turn down a wholesale order',
  "to: 'owner@bakery.example'",
  'expires: PT2M',
  'deliver: agent',
  'input:',
  '  schema:',
  '    type: object',
  '    required: [order]',
  '    properties: { order: { type: string } }',
  'output:',
  '  schema:',
  '    type: object',
  '    required: [accepted]',
  '    properties: { accepted: { type: boolean } }',
  '---',
  'Accept wholesale order {{ input.order }}?',
].join('\n');

const gaveUp = 'Stopped: no decision in time, so no reply was sent. Phone the customer.';

const onAnOrder = ['schedule:', '  on: { one: { with: { type: com.example.order.received } } }'];

const logOrder = [
  'contributes:',
  '  - goal: orders',
  '    purpose: Records each order as it arrives.',
  '    each: /orders',
  '    per_id: /id',
  '    title: /customer',
  '    marks: arrived',
  ...onAnOrder,
  'do:',
  "  - logged: { set: { orders: [{ id: '${ $input[0].data.order }', customer: '${ $input[0].data.customer }' }] } }",
];

const askAboutOrder = [
  'contributes:',
  '  - goal: orders',
  '    purpose: Asks the owner to decide each order.',
  '    per_id: /id',
  '    marks: decided',
  ...onAnOrder,
  'do:',
  '  - ask:',
  '      try:',
  '        - ask-owner:',
  '            call: run_definition',
  "            with: { type: interaction, name: decide-order, input: { order: '${ $input[0].data.order }' } }",
  '      catch:',
  '        do:',
  '          - no-decision: { set: { stopped: true } }',
  "      export: { as: '${ ({ stopped: $data.stopped === true }) }' }",
  '  - stop-without-decision:',
  "      if: '${ $context.stopped === true }'",
  '      raise:',
  '        error:',
  '          type: https://bakery.example/errors/no-decision',
  '          status: 408',
  '          title: No decision in time',
  `          detail: '${gaveUp}'`,
  "  - decided: { set: { id: '${ $input[0].data.order }' } }",
];

const goalsReadOf = Schema.decodeUnknownSync(GoalsReadSchema);

async function juniperOf(watched: WatchedServer): Promise<string> {
  return assessmentIdOf({ definition: await watched.goalOf('orders'), per: 'ORD-1' });
}

async function ordersOf({ server }: WatchedServer): Promise<Assessments> {
  const { body } = await server.call('GET', `${alpha}/goals`);
  const [read] = goalsReadOf(body).goals;
  return read?.assessments ?? noAssessments;
}

async function served(ledger: TemporaryLedger, startsAt?: number, turned?: GoalsPortsTurned) {
  const watched = await servedWatched(ledger, startsAt, turned);
  onTestFinished(watched.server.stop);
  return watched;
}

async function bakeryServed(ledger: TemporaryLedger, turned?: GoalsPortsTurned): Promise<WatchedServer> {
  const watched = await served(ledger, undefined, turned);
  const { server } = watched;
  expect((await createdWithGoals(server, { goals })).status).toBe(201);
  const saved = await server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'decide-order', source: decideOrder, diagram: 'none' },
  });
  expect(saved.status).toBe(201);
  expect(await savedWorkflow(server, 'log-order', logOrder)).toBe(201);
  expect(await savedWorkflow(server, 'ask-about-order', askAboutOrder)).toBe(201);
  const arrived = await server.call('POST', `${alpha}/events`, {
    body: {
      event: {
        source: 'https://mail.bakery.example/inbox',
        type: 'com.example.order.received',
        data: { order: 'ORD-1', customer: 'Juniper Cafe' },
      },
    },
  });
  expect(arrived.status).toBe(200);
  return watched;
}

function blindToEventsOnceAsked(blind: { readonly now: boolean }): GoalsPortsTurned {
  return (ports) => {
    const { store } = ports.database;
    return {
      ...ports,
      database: {
        ...ports.database,
        store: {
          ...store,
          readRecordedEventOfKeys: (keys, id) => store.readRecordedEventOfKeys(keys, blind.now ? 'no-such-record' : id),
        },
      },
    };
  };
}

function aLedger(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

describe('an order whose email started one workflow that marked it and another that gave up asking about it', () => {
  it('reads stopped with the words of the run that gave up, open with no verdict, though neither run is in the other’s chain', async () => {
    const watched = await bakeryServed(aLedger());

    const stopped = await movingUntil(
      watched,
      () => ordersOf(watched),
      ({ stopped_count: stoppedCount }) => stoppedCount === 1,
    );

    expect(stopped.open_count).toBe(1);
    expect(stopped.in_flight[0]).toMatchObject({ id: await juniperOf(watched), verdict: 'open', next: 'priced' });
    expect(stopped.in_flight[0]?.stopped?.reason).toContain(gaveUp);
  }, 120_000);
});

describe('a ledger whose release passed the run that gave up without stopping the order', () => {
  it('shows the order stopped once a server of this release opens it, with no layout step', async () => {
    const ledger = aLedger();
    const blind = { now: false };
    const before = await bakeryServed(ledger, blindToEventsOnceAsked(blind));
    await movingUntil(
      before,
      () => ordersOf(before),
      ({ open_count: open }) => open === 1,
    );
    blind.now = true;
    const passed = await movingUntil(
      before,
      async () => (await before.server.call('GET', `${alpha}/runs?status=rejected`)).body,
      (body) => JSON.stringify(body).includes('ask-about-order'),
    );
    const unstopped = await ordersOf(before);
    const reopenedAt = before.clock.now();
    await before.server.stop();

    const after = await served(ledger, reopenedAt);
    const stopped = await movingUntil(
      after,
      () => ordersOf(after),
      ({ stopped_count: stoppedCount }) => stoppedCount === 1,
    );

    expect(JSON.stringify(passed)).toContain('ask-about-order');
    expect(unstopped).toMatchObject({ open_count: 1, stopped_count: 0 });
    expect(stopped.in_flight[0]?.id).toBe(await juniperOf(after));
    expect(stopped.in_flight[0]?.stopped?.reason).toContain(gaveUp);
  }, 120_000);
});
