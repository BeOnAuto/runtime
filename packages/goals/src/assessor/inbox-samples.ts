import type { Context } from '@on.auto/operations';
import { Effect } from 'effect';

import { assessmentIdOf } from '../assessments/assessment-identity.ts';
import type { ChainFact } from '../chain-origins/chain-origin.ts';
import type { ChainReads } from '../chain-origins/chain-origins.ts';
import { opened } from '../conditions/condition-samples.ts';
import { bookOf, controls, experiments, finished, monday } from './assessor-ledger.ts';
import { assessorOf } from './assessor.ts';
import type { AssessorPorts } from './run-planner.ts';

const orders = {
  id: 'orders',
  statement: 'Every wholesale order is decided within a day of arriving.',
  per: 'order',
  window: { after: 'arrived', for: 'P1D' },
  success: { label: 'Decided', settles: 'on_crossing', target: { at_least: 1 }, passed: 'Decided', failed: 'Late' },
  milestones: [
    { id: 'arrived', label: 'Order arrived', by: 'auto' },
    { id: 'priced', label: 'Order priced', by: 'auto' },
    { id: 'decided', label: 'Decided', by: 'person' },
  ],
  notify: { passed: 'quiet', failed: 'quiet' },
};

export const orderId = (order: string) => assessmentIdOf({ goal: orders.id, per: order });

export const hour = 3_600_000;

export const onEvent: Partial<Context> = { trigger: { kind: 'event', reference: '/schedule/on' } };

const received = (email: string) => `record-${email}`;

function emailArrived(email: string, at: number): readonly [string, ChainFact] {
  return [
    received(email),
    {
      stream: `events/${email}`,
      context: { at: new Date(at).toISOString(), by: 'local' },
      causationId: null,
      correlationId: null,
    },
  ];
}

function startedBy(run: string, email: string, at: number): readonly [string, ChainFact] {
  return [
    run,
    {
      stream: `runs/${run}`,
      context: { at: new Date(at).toISOString(), by: 'playbook:sales', runId: run, ...onEvent },
      causationId: received(email),
      correlationId: run,
    },
  ];
}

export interface Inbox {
  readonly emails: readonly (readonly [string, number])[];
  readonly runs: readonly (readonly [string, string, number])[];
}

function inboxReads({ emails, runs }: Inbox): ChainReads<never> {
  const events = new Map(emails.map(([email, at]) => emailArrived(email, at)));
  const starts = new Map(runs.map(([run, email, at]) => startedBy(run, email, at)));
  return {
    firstFactOf: (run) => Effect.succeed(starts.get(run)),
    recordOf: (id) => Effect.succeed(events.get(id)),
  };
}

export const logged = (id: string, order: string, at = monday) =>
  finished({ id, workflow: 'log-order', at, data: { output: { orders: [{ id: order }] } }, context: onEvent });

export const gaveUp = (id: string, workflow: string, at = monday + 20 * hour) =>
  finished({
    id,
    workflow,
    at,
    type: 'run_rejected',
    data: { rejection: { reason: 'unavailable', detail: 'No decision within 20 hours, so no reply was sent.' } },
    context: onEvent,
  });

export async function inboxBook(inbox: Inbox) {
  const book = bookOf();
  await book.goalsSaved([experiments, controls, orders]);
  await book.workflowSaved('log-order', 1, [
    { goal: orders.id, purpose: 'Records each order.', each: '/orders', per_id: '/id', marks: 'arrived' },
  ]);
  await book.workflowSaved('decide-order', 1, [
    { goal: orders.id, purpose: 'Asks the owner.', per_id: '/id', marks: 'decided' },
  ]);
  await book.workflowSaved('price-order', 1, [
    { goal: orders.id, purpose: 'Prices each order.', per_id: '/id', marks: 'priced' },
  ]);
  await book.workflowSaved('count-mail', 1, [
    { goal: controls.id, purpose: 'Counts unread mail.', measures: '/unread' },
  ]);
  const ports: AssessorPorts<never> = {
    ledger: book.ledger,
    chainsOf: () => inboxReads(inbox),
    callers: { serviceCallers: new Set() },
    filters: opened().sandbox,
    now: () => monday + 21 * hour,
  };
  return { book, ports, assessor: assessorOf(ports) };
}
