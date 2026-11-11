import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { Schema } from 'effect';

import { recordPath } from './behavioural-check.ts';
import { BriefsSchema } from './commands.ts';
import { ModelSchema } from './models.ts';
import { rowsIn } from './record.ts';

const briefs = Schema.decodeUnknownSync(Schema.fromJsonString(BriefsSchema))(
  readFileSync(join(import.meta.dirname, 'briefs.json'), 'utf8'),
).briefs;

await test('the record kept beside the check reads as rows, each with a label of its own', () => {
  const labels = rowsIn(recordPath).map(({ label }) => label);

  assert.equal(new Set(labels).size, labels.length);
});

await test('every model is asked through a command of its own', () => {
  const { models } = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ models: Schema.Array(ModelSchema) })),
  )(readFileSync(join(import.meta.dirname, 'models.json'), 'utf8'));

  assert.deepEqual(
    models.map(({ name }) => name),
    ['gemini', 'codex', 'claude'],
  );
});

await test('the briefs hold each shape, and a shape asked in two lines of business holds one of them out', () => {
  const shapes = ['J', 'C', 'R', 'A', 'P', 'M'] as const;
  const of = (shape: string) => briefs.filter((brief) => brief.shape === shape);

  assert.deepEqual(
    shapes.map((shape) => of(shape).length),
    [2, 2, 2, 2, 1, 1],
  );
  assert.deepEqual(
    shapes.map((shape) => of(shape).filter(({ held_out: heldOut }) => heldOut).length),
    [1, 1, 1, 1, 0, 0],
  );
  assert.equal(new Set(briefs.map(({ business }) => business)).size, briefs.length);
  assert.deepEqual(
    briefs.filter(({ search }) => search).map(({ shape }) => shape),
    ['R', 'R', 'A', 'A', 'M'],
  );
});
