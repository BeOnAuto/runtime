import { Effect } from 'effect';

import { defineMoveDefinitions } from '../moving/move-definitions.ts';
import { storedTypesByStatus } from '../reading/run-status.ts';
import { composedFactsOf } from '../run-work/declared-facts.ts';
import { asking } from './asking.ts';
import { acmeAdmin } from './callers.ts';
import { echo } from './capabilities/echo.ts';
import { flow } from './capabilities/flow.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { toPlaybook, type Harness } from './harness.ts';

export const movingCapabilities = [echo, asking, flow];

const granted: ReadonlySet<string> = new Set(['beta/crm']);

export const connections = {
  hasAccess: ({ playbook }: { readonly playbook: string }, connection: string) =>
    Effect.succeed(connection === 'everywhere' || granted.has(`${playbook}/${connection}`)),
};

export const started = storedTypesByStatus(composedFactsOf(movingCapabilities).onRuns).started;

export const operations = definitionOperationsFor(movingCapabilities);

export const moveDefinitions = defineMoveDefinitions(movingCapabilities, { goals: false, started, connections });

export const toAlpha = toPlaybook('acme', 'alpha');

export const toBeta = toPlaybook('acme', 'beta');

export const greet = { type: 'echo', name: 'greet' };

export const weekly = { type: 'workflow', name: 'weekly' };

export function callsGreet(more: object = {}): string {
  return JSON.stringify({ calls: [{ ...greet, steps: [{ number: 1, name: 'say' }] }], ...more });
}

export type Definitions = Harness;

export async function inAlpha(definitions: Definitions, weeklySource = callsGreet()): Promise<void> {
  const { call } = definitions;
  await call(operations.createDefinition, toAlpha(acmeAdmin, { ...greet, source: '{"greeting":"Hello"}' }));
  await call(operations.updateDefinition, toAlpha(acmeAdmin, { ...greet, source: '{"greeting":"Howdy"}' }));
  await call(operations.createDefinition, toAlpha(acmeAdmin, { ...weekly, source: callsGreet({ version: 1 }) }));
  await call(operations.updateDefinition, toAlpha(acmeAdmin, { ...weekly, source: weeklySource }));
}

export function moving(definitions: Definitions, input: object, caller = acmeAdmin) {
  return definitions.call(moveDefinitions, toAlpha(caller, { to: 'beta', ...input }));
}

export function heldIn(definitions: Definitions): readonly string[] {
  return definitions.ledger
    .names()
    .map(
      ({ playbookKey, definitionType, name }) =>
        `${playbookKey.slice('playbook/acme/'.length, -1)} ${definitionType} ${name}`,
    )
    .toSorted();
}

export function answerOf(outcome: object): Readonly<Record<string, unknown>> {
  const output: unknown = Reflect.get(outcome, 'output');
  return Object.fromEntries(Object.entries(new Object(output)));
}
