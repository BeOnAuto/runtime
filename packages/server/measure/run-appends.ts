import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { ContextSchema, Ledger, type Context, type Decided, type Decider } from '@on.auto/operations';
import { Effect, ManagedRuntime, Result, Schema } from 'effect';

import { percentile } from './measured-server.ts';

type Write = (line: string) => void;

export function inTurn<A>(items: readonly A[], each: (item: A) => Promise<void>): Promise<void> {
  return items.reduce<Promise<void>>(async (done, item) => {
    await done;
    await each(item);
  }, Promise.resolve());
}

export function counting(runs: number): readonly number[] {
  return Array.from({ length: runs }, (_, run) => run + 1);
}

export function statsOf(times: readonly number[]): string {
  const sorted = times.toSorted((left, right) => left - right);
  return `median ${percentile(sorted, 0.5).toFixed(2)} ms, p90 ${percentile(sorted, 0.9).toFixed(2)} ms`;
}

const FactSchema = Schema.Struct({
  type: Schema.String,
  data: Schema.Record(Schema.String, Schema.Json),
  context: ContextSchema,
});

interface Append {
  readonly fact: Decided<typeof FactSchema.Type>;
  readonly context: Context;
}

const appending: Decider<null, Append, typeof FactSchema.Type> = {
  initialState: null,
  evolve: () => null,
  decide: ({ fact }) => Result.succeed([fact]),
  context: ({ context }) => context,
  eventSchema: FactSchema,
};

const appendContext = {
  at: '2026-10-23T09:00:00.000Z',
  by: 'local',
  runId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'reasoning',
  definitionName: 'reading',
  definitionVersion: 1,
};

export async function appendCostOf(file: string, appends: number, write: Write): Promise<void> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName: file }));
  const ledger = await runtime.runPromise(Ledger);
  const stream = 'playbook/local/measure/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';
  const times: number[] = [];
  await inTurn(counting(appends), async (number) => {
    const fact = {
      type: 'model_call_answered',
      data: { number, finish_reason: 'tool_calls', duration_ms: 400, response_bytes: 512 },
    };
    const started = performance.now();
    await Effect.runPromise(ledger.execute(stream, appending, { fact, context: appendContext }));
    times.push(performance.now() - started);
  });
  await runtime.dispose();
  write(`  one append to a run's stream, over ${appends} appends: ${statsOf(times)}`);
}
