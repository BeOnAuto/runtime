import type { Outcome } from '@on.auto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../index.ts';
import { weeklyContributes } from '../read-model-testing/script-operations.ts';
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

function withIdsAside(answers: unknown): string {
  return JSON.stringify(answers).replaceAll(/"definition_id":"[^"]+"/gu, '"definition_id":"made at its creation"');
}

interface Keeping {
  readonly named: string;
  readonly goals: boolean;
  readonly contributesListed: readonly unknown[];
}

const keepings: readonly Keeping[] = [
  { named: 'not kept', goals: false, contributesListed: [undefined] },
  { named: 'kept', goals: true, contributesListed: [weeklyContributes] },
];

const decodeAList = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      definitions: Schema.Array(
        Schema.Struct({
          details: Schema.optionalKey(Schema.Struct({ contributes: Schema.optionalKey(Schema.Json) })),
        }),
      ),
    }),
  }),
);

function contributesListedLast(answers: readonly Outcome[]): readonly unknown[] {
  return decodeAList(answers.at(-1)).output.definitions.map(({ details }) => details?.contributes);
}

describe.each(keepings)(
  'the operations of the definitions, with the read model of the definitions composed, goals $named',
  ({ goals, contributesListed }) => {
    it('answer byte for byte as today while the stage is off, and compare nothing', async () => {
      const today = await answeredBy(harness(), workflow, goals);
      const off = await staged('off', workflow, goals);

      expect(withIdsAside(off.answers)).toBe(withIdsAside(today));
      expect(off.compared).toEqual([]);
    });

    it('answer as today in shadow, each read compared with the read model and every one matched', async () => {
      const today = await answeredBy(harness(), workflow, goals);
      const shadow = await staged('shadow', workflow, goals);

      expect(contributesListedLast(today)).toEqual(contributesListed);
      expect(withIdsAside(shadow.answers)).toBe(withIdsAside(today));
      expect(new Set(shadow.compared.map(([read]) => read))).toEqual(
        new Set(['used_by', 'get_definition', 'triggers_since', 'list_definitions', 'definition_page', 'run_start']),
      );
      expect(shadow.compared.filter(([, outcome]) => outcome !== 'matched')).toEqual([]);
    });

    it('answer as today from the read model at reads and at on, run starts still compared at reads', async () => {
      const today = await answeredBy(harness(), workflow, goals);
      const [reads, on] = [await staged('reads', workflow, goals), await staged('on', workflow, goals)];

      expect([withIdsAside(reads.answers), withIdsAside(on.answers)]).toEqual([
        withIdsAside(today),
        withIdsAside(today),
      ]);
      expect([
        new Set(reads.compared.map(([read, outcome]) => `${String(read)} ${String(outcome)}`)),
        on.compared,
      ]).toEqual([new Set(['run_start matched']), []]);
    });
  },
);
