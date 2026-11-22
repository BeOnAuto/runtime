import { Schema } from 'effect';

import { filledStoreOf } from './filled-stores.ts';
import { fillMeasuredOn } from './src/testing/measured-fill.ts';

const FilledIn = Schema.Union([
  Schema.Struct({ store: Schema.Literal('sqlite'), file: Schema.String }),
  Schema.Struct({ store: Schema.Literal('postgresql'), connectionString: Schema.String }),
]);

const [filledInText = '', factsText = '256', factBytesText = '65536', mostBytesText = '2097152'] =
  process.argv.slice(2);

const store = filledStoreOf(Schema.decodeUnknownSync(Schema.fromJsonString(FilledIn))(filledInText));

function heapUsed(): number {
  globalThis.gc?.();
  globalThis.gc?.();
  return process.memoryUsage().heapUsed;
}

const baseline: { at?: number } = {};

function heldSinceTheFillBegan(): number {
  const now = heapUsed();
  baseline.at ??= now;
  return now - baseline.at;
}

const { history, held, loads, kept, filled } = await fillMeasuredOn(
  store,
  { facts: Number(factsText), factBytes: Number(factBytesText), mostBytesFilledAtOnce: Number(mostBytesText) },
  heldSinceTheFillBegan,
);

process.stdout.write(
  `${JSON.stringify({
    history,
    mostHeld: Math.max(...held),
    mostLoaded: Math.max(...loads),
    loaded: loads.reduce((sum, load) => sum + load, 0),
    kept,
    filled,
  })}\n`,
);
