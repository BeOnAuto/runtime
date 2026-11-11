import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../index.ts';
import { answeredBy, staged } from '../read-model-testing/staged-script.ts';
import { harness } from '../testing/harness.ts';

const decodeDetails = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.JsonObject));

const workflow: Capability = defineCapability({
  type: 'workflow',
  title: 'workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It answered.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodeDetails(source)),
  summarize: (details) => ({ details }),
  run: () => Effect.succeed({ output: null, record: {} }),
});

describe('the operations of the definitions, with the read model of the definitions composed', () => {
  it('answer byte for byte as today while the stage is off, and compare nothing', async () => {
    const today = await answeredBy(harness(), workflow);
    const off = await staged('off', workflow);

    expect(JSON.stringify(off.answers)).toBe(JSON.stringify(today));
    expect(off.compared).toEqual([]);
  });

  it('answer as today in shadow, each read compared with the read model and every one matched', async () => {
    const today = await answeredBy(harness(), workflow);
    const shadow = await staged('shadow', workflow);

    expect(JSON.stringify(shadow.answers)).toBe(JSON.stringify(today));
    expect(new Set(shadow.compared.map(([read]) => read))).toEqual(
      new Set(['used_by', 'get_definition', 'list_definitions', 'definition_page', 'run_start']),
    );
    expect(shadow.compared.filter(([, outcome]) => outcome !== 'matched')).toEqual([]);
  });

  it('answer as today from the read model at reads and at on, run starts still compared at reads', async () => {
    const today = await answeredBy(harness(), workflow);
    const [reads, on] = [await staged('reads', workflow), await staged('on', workflow)];

    expect([reads.answers, on.answers]).toEqual([today, today]);
    expect([
      new Set(reads.compared.map(([read, outcome]) => `${String(read)} ${String(outcome)}`)),
      on.compared,
    ]).toEqual([new Set(['run_start matched']), []]);
  });
});
