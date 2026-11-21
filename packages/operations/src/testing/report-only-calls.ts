import { Effect } from 'effect';

import {
  allPermissions,
  reportedDifferenceMessage,
  type AccessDecision,
  type CallerIdentity,
  type Dispatcher,
  type DispatcherServices,
  type Outcome,
  type PolicyDecisionPoint,
} from '../index.ts';
import { acmeAdmin, acmeAlphaReader } from './callers.ts';
import { capturedLogs, type CapturedLog } from './captured-logs.ts';
import { decidingEach } from './decision-points.ts';
import { harness, toOrg, toPlaybook } from './harness.ts';
import { addNote, getNote } from './notes.ts';
import { labelPlaybook } from './playbook-labels.ts';

export const ada: CallerIdentity = {
  id: 'person:user_ada',
  name: 'Ada Lovelace',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

const adaReading: CallerIdentity = { ...ada, permissions: ['org:read', 'playbook:read'] };

const mailer: CallerIdentity = { ...acmeAdmin, id: 'service:mailer', name: 'The mailer' };

export const onAlpha = toPlaybook('acme', 'alpha');

type Dispatched = (dispatcher: Dispatcher) => Effect.Effect<Outcome, never, DispatcherServices>;

export const reportedCalls: readonly Dispatched[] = [
  (dispatcher) => dispatcher.dispatchToPlaybook(getNote.registration, onAlpha(ada, { name: 'anvil' })),
  (dispatcher) =>
    dispatcher.dispatchToPlaybook(addNote.registration, onAlpha(ada, { name: 'anvil', text: 'a secret' })),
  (dispatcher) => dispatcher.dispatchToPlaybook(addNote.registration, onAlpha(adaReading, { name: 'bolt', text: 'b' })),
  (dispatcher) =>
    dispatcher.dispatchToPlaybook(getNote.registration, toPlaybook('acme', 'beta')(acmeAlphaReader, { name: 'x' })),
  (dispatcher) => dispatcher.dispatchToPlaybook(getNote.registration, toPlaybook('globex', 'gamma')(ada)),
  (dispatcher) =>
    dispatcher.dispatchToOrg(labelPlaybook.registration, toOrg('acme')(ada, { playbook: 'beta', label: 'red' })),
  (dispatcher) =>
    dispatcher.dispatchToOrg(
      labelPlaybook.registration,
      toOrg('acme')(adaReading, { playbook: 'beta', label: 'blue' }),
    ),
  (dispatcher) => dispatcher.dispatchToPlaybook(getNote.registration, onAlpha(mailer, { name: 'anvil' })),
];

export interface Answered {
  readonly outcomes: readonly Outcome[];
  readonly streams: readonly string[];
  readonly logged: readonly CapturedLog[];
  readonly text: string;
}

export async function answeredWith(reportOnly?: PolicyDecisionPoint, dispatched = reportedCalls): Promise<Answered> {
  const { dispatcher, ledger, run } = harness(reportOnly === undefined ? {} : { reportOnly });
  const logs = capturedLogs();
  const outcomes = await run(Effect.forEach(dispatched, (call) => call(dispatcher)).pipe(Effect.provide(logs.layer)));
  return { outcomes, streams: ledger.streamNames(), logged: logs.logged(), text: logs.text() };
}

export function answering(decision: AccessDecision): PolicyDecisionPoint {
  return decidingEach(() => Effect.succeed(decision));
}

export const dying: PolicyDecisionPoint = {
  decide: () => Effect.die(new Error('the engine broke')),
  decideBatch: () => Effect.die(new Error('the engine broke')),
};

function threw(): never {
  throw new Error('the engine threw');
}

export const throwing: PolicyDecisionPoint = { decide: threw, decideBatch: threw };

export function differenceOf(annotations: Readonly<Record<string, unknown>>) {
  return { message: reportedDifferenceMessage, level: 'WARN', annotations };
}

export function fieldsOf(logged: readonly CapturedLog[], ...names: readonly string[]): readonly (readonly unknown[])[] {
  return logged.map(({ annotations }) => names.map((name) => annotations[name]));
}
