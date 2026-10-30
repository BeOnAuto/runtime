import { Effect, Schema } from 'effect';
import { parse } from 'yaml';

import type { DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { skippingClock } from '../src/loop/host-clock.ts';
import { header, measuredHost, runAt, startOf } from './measured-host.ts';

export interface Throughput {
  readonly runs: number;
  readonly inputs: number;
  readonly milliseconds: number;
}

const startedAt = 1_790_845_200_000;

const decodeObject = Schema.decodeUnknownSync(Schema.JsonObject);

function ticking(inputs: number): Schema.JsonObject {
  return {
    document: header,
    ...decodeObject(
      parse(`
do:
  - tick: { wait: PT1S }
  - count: { set: '\${ ({ n: ($data.n ?? 0) + 1 }) }' }
  - again: { switch: [{ more: { when: '\${ $data.n < ${inputs - 1} }', then: tick } }] }
`),
    ),
  };
}

export async function throughputOn(database: DatabaseSettings, runs: number, inputsEach: number): Promise<Throughput> {
  const measured = await measuredHost(database, skippingClock(startedAt));
  const started = performance.now();
  await Effect.runPromise(
    Effect.forEach(
      Array.from({ length: runs }, (_, index) => runAt(index)),
      (run) => measured.host.start(run, startOf(ticking(inputsEach))),
      { discard: true },
    ),
  );
  await measured.untilSettled(runs);
  const milliseconds = performance.now() - started;
  await measured.host.stop();
  return { runs, inputs: runs * inputsEach, milliseconds };
}
