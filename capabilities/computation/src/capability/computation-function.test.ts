import { shapeNamed } from '@on.auto/definitions/testing';
import { Effect, Exit, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { computationBounds } from '../run/run-bounds.ts';
import { campaignPace, campaignRows } from '../testing/campaign-pace.ts';
import { computationWith, functionOf, poolOf, programDocument, type Run } from '../testing/computation-runs.ts';

const decodeFinished = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      campaigns: Schema.Array(
        Schema.Struct({
          campaign: Schema.String,
          spend_cents: Schema.Number,
          budget_cents: Schema.Number,
          projected_cents: Schema.Number,
          pace_permille: Schema.Number,
        }),
      ),
      total_spend_cents: Schema.Number,
    }),
    record: Schema.Struct({
      language: Schema.Literal('typescript'),
      work: Schema.Number,
      duration_ms: Schema.Number,
      input_bytes: Schema.Number,
      output_bytes: Schema.Number,
    }),
  }),
);

const decodeRows = Schema.decodeUnknownSync(
  Schema.Struct({
    rows: Schema.Array(
      Schema.Struct({ campaign: Schema.String, cost_cents: Schema.Number, budget_cents: Schema.Number }),
    ),
    period: Schema.Struct({ days_elapsed: Schema.Number, days_total: Schema.Number }),
  }),
);

function paceInBigIntegers(input: unknown) {
  const { rows, period } = decodeRows(input);
  const names = [...new Set(rows.map(({ campaign }) => campaign))].toSorted();
  const campaigns = names.map((campaign) => {
    const own = rows.filter((row) => row.campaign === campaign);
    const spend = own.reduce((sum, { cost_cents }) => sum + BigInt(cost_cents), 0n);
    const budget = BigInt(own[0]?.budget_cents ?? 0);
    const projected = (spend * BigInt(period.days_total)) / BigInt(period.days_elapsed);
    return {
      campaign,
      spend_cents: Number(spend),
      budget_cents: Number(budget),
      projected_cents: Number(projected),
      pace_permille: Number((projected * 1000n) / budget),
    };
  });
  return {
    campaigns,
    total_spend_cents: campaigns.reduce(
      (sum: number, { spend_cents }: { readonly spend_cents: number }) => sum + spend_cents,
      0,
    ),
  };
}

async function succeeded(running: () => Promise<Run>): Promise<unknown> {
  return Option.getOrThrow(Exit.getSuccess(await running()));
}

describe('a run of a computation function', () => {
  it('applies its program to its input and answers its output exactly, in cents, with what the run took', async () => {
    const input = campaignRows(1000);

    const { output, record } = decodeFinished(await succeeded(() => computationWith().running(campaignPace, input)));

    expect(output).toEqual(paceInBigIntegers(input));
    expect(output.campaigns.map(({ spend_cents }) => spend_cents)).toEqual([
      1_346_500, 1_346_750, 1_347_000, 1_347_250,
    ]);
    expect(record).toMatchObject({ language: 'typescript', input_bytes: JSON.stringify(input).length });
    expect(record.output_bytes).toBe(JSON.stringify(output).length);
    expect(record.work).toBe(0);
    expect(record.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('computes with doubles: integers exactly, and decimal fractions as doubles do', async () => {
    const run = computationWith();

    expect(
      await succeeded(() =>
        run.running(programDocument(functionOf('return [0.1, 0.2, 0.3].reduce((sum, each) => sum + each, 0);'))),
      ),
    ).toMatchObject({ output: 0.6000000000000001 });
    expect(
      await succeeded(() => run.running(programDocument(functionOf('return 9007199254740992 + 1;')))),
    ).toMatchObject({
      output: 9_007_199_254_740_992,
    });
  });

  it('runs its program as written, its dollar signs among it, when its save stripped its types', async () => {
    const dollars = "return [`$$`, '$&', \"$'\", '$`'].map((text: string) => text + (input as string));";

    expect(await succeeded(() => computationWith().running(programDocument(functionOf(dollars)), '!'))).toMatchObject({
      output: ['$$!', '$&!', "$'!", '$`!'],
    });
  });
});

describe('a computation function', () => {
  it('describes its result in words', () => {
    const { capability } = computationWith(poolOf({ workers: 1 }));

    expect(capability.describeOutput({ total_spend_cents: 17_628 })).toBe('Its result: total spend cents: 17628.');
    expect(capability.describeOutput('x'.repeat(5000))).toBe(
      'Its result is too long to repeat here; the whole of it is in the details below.',
    );
  });
});

describe('the summary of a computation function', () => {
  it('is its description and its schemas, and it reaches nothing outside', () => {
    const { capability, prepared } = computationWith(poolOf({ workers: 1 }), {
      deadlineMs: computationBounds.deadlineMs,
    });

    expect(prepared(campaignPace).summary).toMatchObject({
      description: 'Spend, pace and projection per campaign, in cents, for a reporting period',
      inputSchema: { type: 'object', required: ['rows', 'period'] },
      outputSchema: { type: 'object', required: ['campaigns', 'total_spend_cents'] },
    });
    expect(prepared(programDocument(functionOf('return input;'))).summary).toEqual({});
    expect(capability).toMatchObject({
      type: 'computation',
      title: 'Computation',
      noun: { one: 'computation function', other: 'computation functions' },
      mediaType: 'text/markdown',
      reachesOutside: false,
      mayChangeOutside: false,
      longestAnyRunMs: 10_000,
    });
    expect(prepared(campaignPace).callsTools).toBe(false);
  });

  it('publishes the schema of the shape its output names as its output schema, and the shape in its details', () => {
    const { prepared } = computationWith(poolOf({ workers: 1 }));
    const source = programDocument(functionOf('return input;'), 'language: typescript\noutput: {shape: categories}');

    expect(prepared(source).summary).toEqual({
      outputSchema: shapeNamed('categories').schema,
      details: { shape: 'categories' },
    });
  });
});

describe('a computation function definition that is refused', () => {
  it('is refused with its problems, each with its line', async () => {
    const { capability } = computationWith(poolOf({ workers: 1 }));

    expect(
      await Effect.runPromise(Effect.flip(capability.prepare(programDocument('\n', 'language: python\nmodel: big')))),
    ).toMatchObject({
      detail: 'The computation function definition has 2 problems',
      issues: [
        {
          pointer: '',
          detail:
            'Line 3, /model: model is not a key of the front matter; it takes description, language, input, output',
        },
        { pointer: '', detail: 'Line 5: The definition has no program: write it after the front matter' },
      ],
    });
    expect(
      await Effect.runPromise(
        Effect.flip(capability.prepare(programDocument(functionOf('return 1;'), 'language: python'))),
      ),
    ).toMatchObject({
      detail: 'The computation function definition has a problem',
      issues: [
        {
          pointer: '',
          detail:
            "Line 2, /language: The playbook's one language is TypeScript; write the program as a TypeScript function",
        },
      ],
    });
  });
});
