import { ContextSchema, type Decider } from '@on.auto/operations';
import type { memoryLedger } from '@on.auto/operations/testing';
import { Effect, Result, Schema } from 'effect';

const RunFactSchema = Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema });

type RunFact = typeof RunFactSchema.Type;

export const verbatim: Decider<null, RunFact, RunFact> = {
  initialState: null,
  evolve: () => null,
  decide: ({ type, data }) => Result.succeed([{ type, data }]),
  context: ({ context }) => context,
  eventSchema: RunFactSchema,
};

const onAnEvent = { kind: 'event', reference: '/schedule/on' } as const;

export function runStartedByAnEventIn(service: ReturnType<typeof memoryLedger>['service']) {
  return (run: string, cause: string, at: number): Promise<void> =>
    Effect.runPromise(
      Effect.asVoid(
        service.execute(
          `playbook/acme/sales/runs/${run}`,
          verbatim,
          {
            type: 'run_started',
            data: { input: {} },
            context: { at: new Date(at).toISOString(), by: 'playbook:sales', runId: run, trigger: onAnEvent },
          },
          { causationId: cause, correlationId: run },
        ),
      ),
    );
}
