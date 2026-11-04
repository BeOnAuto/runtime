import { readFileSync } from 'node:fs';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { runsDocument, runsHarness } from '../testing/index.ts';

const referencePage = readFileSync(new URL('../../../../docs/reference/lookup-format.md', import.meta.url), 'utf8');

const [, runsExample, input, answer] = [...referencePage.matchAll(/^(`{3,4})(\w+)\n([\s\S]*?)^\1$/gmu)].map(
  ([, , language = '', body = '']: readonly string[]) => ({ language, body }),
);

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const decodeAnswer = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      runs: Schema.Tuple([Schema.Struct({ run_id: Schema.String, started_at: Schema.String, output: Schema.Json })]),
    }),
  ),
);

const decodeRun = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ output: Schema.Json, record: Schema.Json }) }),
);

const springSaleAlone = {
  campaigns: [
    {
      campaign: 'spring-sale',
      spend_cents: 223_050,
      budget_cents: 800_000,
      projected_cents: 576_212,
      pace_permille: 720,
    },
  ],
  total_spend_cents: 223_050,
};

describe('the example of reading runs on the reference page of lookup functions', () => {
  it('is, byte for byte, the document the tests run', () => {
    expect(runsExample?.language).toBe('markdown');
    expect(runsExample?.body).toBe(runsDocument());
  });

  it('answers the input the page gives with the output and the record the page shows, after the runs it says', async () => {
    const harness = runsHarness();
    const {
      runs: [shown],
    } = decodeAnswer(answer?.body);
    await harness.saved('computation', 'campaign-pace', 'Answers its input');
    await harness.saved('lookup', 'pace-history', String(runsExample?.body));
    await harness.ran({
      type: 'computation',
      name: 'campaign-pace',
      input: shown.output,
      at: shown.started_at,
      runId: shown.run_id,
    });
    await harness.ran({
      type: 'computation',
      name: 'campaign-pace',
      input: springSaleAlone,
      at: '2026-10-14T09:00:00.000Z',
    });
    const asked = await harness.ran({
      type: 'lookup',
      name: 'pace-history',
      input: decodeJson(input?.body),
      at: '2026-10-15T09:00:00.000Z',
    });

    expect([input?.language, answer?.language]).toEqual(['json', 'json']);
    expect(decodeRun(asked).output).toEqual({
      output: decodeJson(answer?.body),
      record: { examined: 2, through: shown.started_at },
    });
    expect(referencePage).toContain(`\`{ "examined": 2, "through": "${shown.started_at}" }\``);
  });
});
