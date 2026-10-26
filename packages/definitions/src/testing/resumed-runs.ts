import type { CallLink } from '@on.auto/operations';
import { Deferred, Effect } from 'effect';

import { modelCallAnswered, modelCallSent } from '../journal-testing/model-calls.ts';
import { runDecider, runStreamNameOf } from '../runs/run-decider.ts';
import { isRunning, startedRunOf } from '../runs/run-state.ts';
import { acmeAdmin } from './callers.ts';
import { resumer, type ResumerOptions } from './capabilities/resumer.ts';
import { definitionOperationsFor } from './definition-operations.ts';
import { firstMoment, harness, toPlaybook, type Harness } from './harness.ts';
import { testRunId } from './run-facts.ts';

const toAlpha = toPlaybook('acme', 'alpha');

export const stream = `playbook/acme/alpha/${runStreamNameOf(testRunId)}`;

const aWorkflowsCall: CallLink = { run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b70', reference: '/do/0/step', run: 1 };

export const acted = { runId: testRunId, by: 'acme-admin', at: firstMoment };

export const askedOfTheRun = toAlpha(acmeAdmin, { run_id: testRunId });

export const startOfTheStep = {
  type: 'start',
  definition_type: 'resumer',
  name: 'step',
  input: {},
  started_by: { id: acmeAdmin.id, name: acmeAdmin.name },
  definition_version: 1,
  calls_tools: true,
  resumes: true,
  ...acted,
} as const;

export function heldAfterItsCall() {
  const called = Deferred.makeUnsafe<true>();
  const released = Deferred.makeUnsafe<true>();
  return {
    called,
    released,
    afterItsCall: Effect.andThen(Deferred.succeed(called, true), Deferred.await(released)),
  };
}

export function momentAfter(ms: number): string {
  return new Date(Date.parse(firstMoment) + ms).toISOString();
}

export async function startedAndLeft(options: ResumerOptions = {}) {
  const resuming = resumer(options);
  const operations = definitionOperationsFor([resuming.capability]);
  const definitions = harness();
  const defining = (source: string, operation = operations.createDefinition) =>
    definitions.call(operation, toAlpha(acmeAdmin, { type: 'resumer', name: 'step', source }));
  await defining('first');
  await definitions.run(
    Effect.orDie(
      Effect.all([
        definitions.ledger.service.execute(stream, runDecider, startOfTheStep),
        definitions.ledger.service.execute(stream, runDecider, {
          type: 'call',
          fact: { type: 'model_call_started', data: { number: 1, ...modelCallSent() } },
          ...acted,
        }),
      ]),
    ),
  );
  await defining('second', operations.updateDefinition);
  const asked = { type: 'resumer', name: 'step', input: {}, run_id: testRunId };
  const requested = (attemptDied?: true, calledBy?: CallLink) => ({
    ...toAlpha(acmeAdmin, asked),
    ...(attemptDied === undefined ? {} : { attemptDied }),
    ...(calledBy === undefined ? {} : { calledBy }),
  });
  const running = (at: string, attemptDied?: true) =>
    definitions.call(operations.runDefinition, requested(attemptDied), at);
  const asking = (attemptDied?: true) => definitions.dispatch(operations.runDefinition, requested(attemptDied));
  const askedByACall = (attemptDied?: true) =>
    definitions.dispatch(operations.runDefinition, requested(attemptDied, aWorkflowsCall));
  const cancelling = definitions.dispatch(operations.cancelRun, toAlpha(acmeAdmin, { run_id: testRunId }));
  return { ...definitions, ...operations, resuming, running, asking, askedByACall, cancelling };
}

export function endedIn({ ledger }: Harness): Effect.Effect<void> {
  const going = Effect.map(ledger.service.load(stream, runDecider), ({ state }) => {
    const recorded = startedRunOf(state);
    return recorded !== undefined && isRunning(recorded);
  });
  return Effect.asVoid(Effect.repeat(Effect.andThen(Effect.yieldNow, going), { while: (started) => started }));
}

export function cancelRecordedIn({ ledger }: Harness): Effect.Effect<void> {
  const asked = Effect.map(ledger.service.load(stream, runDecider), ({ state }) => startedRunOf(state)?.cancel);
  return Effect.asVoid(
    Effect.repeat(Effect.andThen(Effect.yieldNow, asked), { until: (cancel) => cancel !== undefined }),
  );
}

type BeforeItsEnds = NonNullable<ResumerOptions['beforeItsEnds']>;

export function answeredOnceMeanwhile() {
  const held: { definitions: Harness | undefined; asked: number } = { definitions: undefined, asked: 0 };
  return {
    beforeItsEnds: ((attempt) => {
      held.asked += 1;
      if (held.asked === 1 && held.definitions !== undefined) {
        const fact = { type: 'model_call_answered', data: { number: 2, ...modelCallAnswered() } } as const;
        Effect.runSync(
          Effect.orDie(held.definitions.ledger.service.execute(stream, runDecider, { type: 'call', fact, ...acted })),
        );
      }
      return attempt;
    }) satisfies BeforeItsEnds,
    over: (definitions: Harness) => {
      held.definitions = definitions;
    },
  };
}
