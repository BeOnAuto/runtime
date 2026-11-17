import { assessmentIdOf } from '@on.auto/goals';
import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { savedWorkflow } from '../testing/goals/assessed-runs.ts';
import { movingUntil, servedWatched, type WatchedServer } from '../testing/goals/watched-goals.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
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
  'expires: P1D',
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
  '  - ask-owner:',
  '      call: run_definition',
  "      with: { type: interaction, name: decide-order, input: { order: '${ $input[0].data.order }' } }",
  "  - decided: { set: { id: '${ $input[0].data.order }' } }",
];

const Listed = Schema.Struct({
  interactions: Schema.Array(
    Schema.Struct({
      message: Schema.String,
      causes: Schema.optionalKey(Schema.Array(Schema.String)),
      about: Schema.optionalKey(
        Schema.Array(Schema.Struct({ goal: Schema.String, id: Schema.String, per: Schema.optionalKey(Schema.String) })),
      ),
    }),
  ),
});

type Interactions = (typeof Listed.Type)['interactions'];

async function playbookServed(): Promise<WatchedServer> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const watched = await servedWatched(ledger);
  onTestFinished(watched.server.stop);
  const { server } = watched;
  const made = await createdWithGoals(server, { goals });
  expect([made.status, made.body]).toEqual([201, expect.anything()]);
  const saved = await server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'decide-order', source: decideOrder, diagram: 'none' },
  });
  expect(saved.status).toBe(201);
  expect(await savedWorkflow(server, 'log-order', logOrder)).toBe(201);
  expect(await savedWorkflow(server, 'ask-about-order', askAboutOrder)).toBe(201);
  return watched;
}

function anOrderArrived({ server }: WatchedServer, order: string, customer: string) {
  return server.call('POST', `${alpha}/events`, {
    body: {
      event: {
        source: 'https://mail.bakery.example/inbox',
        type: 'com.example.order.received',
        data: { order, customer },
      },
    },
  });
}

async function requestsOf({ server }: WatchedServer): Promise<Interactions> {
  const { body } = await server.call('GET', `${alpha}/interactions`);
  return Schema.decodeUnknownSync(Listed)(body).interactions;
}

function eachAboutAThing(interactions: Interactions): boolean {
  return interactions.length === 2 && interactions.every(({ about }) => about !== undefined && about.length > 0);
}

describe('a question a workflow asks about an order another workflow started by the same email marked', () => {
  it('names the order it is about, though neither run is in the other’s chain, and no other order', async () => {
    const watched = await playbookServed();

    expect((await anOrderArrived(watched, 'ORD-1', 'Juniper Cafe')).status).toBe(200);
    expect((await anOrderArrived(watched, 'ORD-2', 'Harbor Deli')).status).toBe(200);
    const asked = await movingUntil(watched, () => requestsOf(watched), eachAboutAThing);

    const byMessage = Object.fromEntries(asked.map(({ message, about }) => [message, about]));
    expect(byMessage).toEqual({
      'Accept wholesale order ORD-1?': [
        { goal: 'orders', id: assessmentIdOf({ goal: 'orders', per: 'ORD-1' }), per: 'ORD-1' },
      ],
      'Accept wholesale order ORD-2?': [
        { goal: 'orders', id: assessmentIdOf({ goal: 'orders', per: 'ORD-2' }), per: 'ORD-2' },
      ],
    });
    expect(asked.map(({ causes }) => causes)).toEqual([[expect.any(String)], [expect.any(String)]]);
  }, 120_000);
});
