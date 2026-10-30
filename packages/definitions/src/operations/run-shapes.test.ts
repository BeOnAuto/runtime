import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, publishedOutputOf } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { shapeNamed } from '../testing/shapes.ts';

const texts = defineCapability({
  type: 'texts',
  title: 'Texts',
  guide: { name: 'texts' },
  noun: { one: 'text', other: 'texts' },
  describeOutput: () => 'It answered.',
  mediaType: 'text/plain',
  parse: (source) => Effect.succeed(source),
  summarize: () => publishedOutputOf({ shape: shapeNamed('text') }),
  answersItsShapeFor: (_source, input) => input !== 'plainly',
  run: (source, input) => Effect.succeed({ output: input === 'plainly' ? source : { text: source }, record: {} }),
});

const { createDefinition, runDefinition, getRun, listRuns } = definitionOperationsFor([echo, texts]);

const toAlpha = toPlaybook('acme', 'alpha');

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      runs: Schema.Array(Schema.Struct({ run_id: Schema.String, output_shape: Schema.optionalKey(Schema.String) })),
    }),
  }),
);

const runs = {
  shaped: '0199a3c4-7d2e-7c1a-9b3f-777777777771',
  plain: '0199a3c4-7d2e-7c1a-9b3f-777777777772',
  unshaped: '0199a3c4-7d2e-7c1a-9b3f-777777777773',
};

async function withThreeRuns() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'texts', name: 'note', source: 'Hello' }));
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: '{"greeting": "Hi"}' }),
  );
  await definitions.call(runDefinition, toAlpha(acmeAdmin, { type: 'texts', name: 'note', run_id: runs.shaped }));
  await definitions.call(
    runDefinition,
    toAlpha(acmeAdmin, { type: 'texts', name: 'note', input: 'plainly', run_id: runs.plain }),
  );
  await definitions.call(runDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', run_id: runs.unshaped }));
  return definitions;
}

describe('the shape of the output of a run', () => {
  it('is the shape its definition declares, for a run of the kind that answers it', async () => {
    const { call } = await withThreeRuns();

    expect(await call(getRun, toAlpha(acmeAdmin, { run_id: runs.shaped }))).toMatchObject({
      output: { run_id: runs.shaped, status: 'succeeded', output_shape: 'text', output: { text: 'Hello' } },
    });
  });

  it('is left out of a run of a kind that answers no shape, and of a run whose definition declares none', async () => {
    const { call } = await withThreeRuns();
    const plain = await call(getRun, toAlpha(acmeAdmin, { run_id: runs.plain }));
    const unshaped = await call(getRun, toAlpha(acmeAdmin, { run_id: runs.unshaped }));

    expect([plain, unshaped]).toMatchObject([{ output: { status: 'succeeded' } }, { output: { status: 'succeeded' } }]);
    expect(plain).not.toHaveProperty('output.output_shape');
    expect(unshaped).not.toHaveProperty('output.output_shape');
  });

  it('is listed with the run', async () => {
    const { call } = await withThreeRuns();
    const { output } = decodeListed(await call(listRuns, toAlpha(acmeAdmin, {})));

    expect(output.runs).toEqual([
      { run_id: runs.unshaped },
      { run_id: runs.plain },
      { run_id: runs.shaped, output_shape: 'text' },
    ]);
  });
});
