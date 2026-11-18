import { expect, onTestFinished } from 'vitest';

import { temporaryLedger } from '../records/temporary-ledger.ts';
import { alpha } from '../servers/reasoning-server.ts';
import { createdWithGoals } from '../settings/goals-kept.ts';
import { savedWorkflow } from './assessed-runs.ts';
import { servedWatched, type WatchedServer } from './watched-goals.ts';

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
  '  - ask-again:',
  '      call: run_definition',
  "      with: { type: interaction, name: confirm-order, input: { order: '${ $workflow.input[0].data.order }' } }",
  "  - decided: { set: { id: '${ $input[0].data.order }' } }",
];

export async function playbookServed(): Promise<WatchedServer> {
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
  const confirming = await server.call('POST', `${alpha}/definitions/interaction`, {
    body: {
      name: 'confirm-order',
      source: decideOrder.replace('Accept wholesale order', 'Confirm wholesale order'),
      diagram: 'none',
    },
  });
  expect([saved.status, confirming.status]).toEqual([201, 201]);
  expect(await savedWorkflow(server, 'log-order', logOrder)).toBe(201);
  expect(await savedWorkflow(server, 'ask-about-order', askAboutOrder)).toBe(201);
  return watched;
}

export function anOrderArrived({ server }: WatchedServer, order: string, customer: string) {
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
