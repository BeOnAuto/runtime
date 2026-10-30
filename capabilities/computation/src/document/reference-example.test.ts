import { readFileSync } from 'node:fs';

import { Exit, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { campaignPace } from '../testing/campaign-pace.ts';
import { computationWith } from '../testing/computation-runs.ts';

const referencePage = readFileSync(
  new URL('../../../../docs/reference/computation-format.md', import.meta.url),
  'utf8',
);

const fencedBlocks = [...referencePage.matchAll(/```(\w+)\n([\s\S]*?)```/gu)].map(
  ([, language = '', body = '']: readonly string[]) => ({ language, body }),
);

const shapesPage = readFileSync(new URL('../../../../docs/reference/output-shapes.md', import.meta.url), 'utf8');

const shapedBlocks = [...shapesPage.matchAll(/```(markdown|json)\n([\s\S]*?)```/gu)].map(
  ([, language = '', body = '']: readonly string[]) => ({ language, body }),
);

const [, shapedExample = { language: '', body: '' }] = shapedBlocks;

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

describe('the example on the reference page of computation functions', () => {
  it('is, byte for byte, the document the tests run', () => {
    const [example] = fencedBlocks;

    expect(example?.language).toBe('markdown');
    expect(example?.body).toBe(`${campaignPace}\n`);
  });

  it('answers the input the page gives with the output the page shows, spending the work it says', async () => {
    const [, input, output] = fencedBlocks;

    expect([input?.language, output?.language]).toEqual(['json', 'json']);
    expect(referencePage).toContain('spent 0 checkpoints of work');
    expect(await computationWith().running(campaignPace, decodeJson(input?.body))).toMatchObject(
      Exit.succeed({ output: decodeJson(output?.body), record: { work: 0 } }),
    );
  });
});

describe('the computation function of the reference of output shapes', () => {
  const [, , input, output] = shapedBlocks;

  it('answers the input the page gives with the series the page shows', async () => {
    expect([shapedExample.language, input?.language, output?.language]).toEqual(['markdown', 'json', 'json']);
    expect(await computationWith().running(shapedExample.body, decodeJson(input?.body))).toMatchObject(
      Exit.succeed({ output: decodeJson(output?.body) }),
    );
  });

  it('ends a run as the page says when a month is not in the form of its period', async () => {
    const months = [
      { month: '2026-08', signups: 40 },
      { month: '2026-9', signups: 52 },
    ];

    const detail =
      "The program's output does not match the output schema: /lines/0/points/1/at: Expected a month in the form YYYY-MM";

    expect(shapesPage).toContain(`\`${detail}\``);
    expect(await computationWith().running(shapedExample.body, { months })).toMatchObject(
      Exit.fail({ kind: 'unworkable', detail }),
    );
  });
});
