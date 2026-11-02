import { describe, expect, it } from 'vitest';

import { memoryHarness, memoryInput, recallDocument, rememberDocument } from '../testing/index.ts';

async function keptBy(remember: readonly string[], input: readonly string[] = memoryInput) {
  const harness = memoryHarness({ mostKept: 2 });
  await harness.define('keep', rememberDocument(remember, input));
  return harness;
}

async function ranWith(remember: readonly string[], input: object, inputLines?: readonly string[]) {
  const harness = await keptBy(remember, inputLines);
  return harness.run('keep', input);
}

describe('the run of a memory function that remembers, as it renders its text', () => {
  it('ends unworkable where the text it renders is empty, or longer than a memory holds', async () => {
    expect([await ranWith([], { fact: '  ' }), await ranWith([], { fact: 'x'.repeat(2001) })]).toMatchObject([
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'unworkable',
        detail: 'The text of a memory is empty: a memory holds 1 to 2,000 characters of text',
      },
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'unworkable',
        detail: 'The text of a memory holds at most 2,000 characters, and this one has 2,001',
      },
    ]);
  });

  it('ends unworkable where a tag, a day, a span, a duration or an id it renders is out of bounds', async () => {
    const refusals = [
      await ranWith(["tags: ['{{ input.about }}']"], { fact: 'x', about: 'Not A Tag' }),
      await ranWith(["about: { from: '{{ input.about }}', to: '2026-10-01' }"], { fact: 'x', about: 'today' }),
      await ranWith(["about: { from: '{{ input.about }}', to: '2026-10-01' }"], { fact: 'x', about: '2026-10-02' }),
      await ranWith(["expires: '{{ input.about }}'"], { fact: 'x', about: 'P0D' }),
      await ranWith(["replaces: '{{ input.replaces }}'"], { fact: 'x', replaces: 'someone' }),
    ];

    expect(refusals).toMatchObject([
      {
        kind: 'unworkable',
        detail:
          '"Not A Tag" is not a tag: a tag is 1 to 32 lowercase letters, digits and hyphens, starting with a letter or a digit',
      },
      { kind: 'unworkable', detail: '"today" is not a day, as YYYY-MM-DD' },
      { kind: 'unworkable', detail: 'What a memory is about ends on 2026-10-01, before it begins on 2026-10-02' },
      {
        kind: 'unworkable',
        detail:
          'P0D is not a time a memory may be kept. A memory expires after a duration from P1D to P3650D, such as P30D',
      },
      { kind: 'unworkable', detail: '"someone" is not the id of a memory' },
    ]);
  });
});

describe('the run of a memory function that remembers, given an input it cannot render', () => {
  it('refuses an input its schema refuses, and one its templates cannot render', async () => {
    expect([
      await ranWith([], {}),
      await ranWith(["tags: ['{{ input.about.deeper }}']"], { fact: 'x' }, ['input:', '  schema: { type: object }']),
      await ranWith(["tags: ['{{ input.about | money }}']"], { fact: 'x', about: 'many' }),
      await ranWith(["tags: ['{% for each in (1..90000000) %}x{% endfor %}']"], { fact: 'x' }),
    ]).toMatchObject([
      { reason: 'invalid_input' },
      {
        reason: 'invalid_input',
        issues: [
          { detail: 'Line 7, /remember/tags/0: the template reads input.about, which this input does not have' },
        ],
      },
      {
        reason: 'invalid_input',
        issues: [{ detail: 'Line 10, /remember/tags/0: money takes a number, or text that is a decimal number' }],
      },
      {
        reason: 'invalid_input',
        issues: [{ detail: 'Line 10, /remember/tags/0: the render takes more memory than a render may' }],
      },
    ]);
  });
});

describe('the run of a memory function that remembers, as it keeps the memory', () => {
  it('ends unworkable where it replaces a memory that is not there, and in conflict where that memory was forgotten', async () => {
    const harness = await keptBy(["replaces: '{{ input.replaces }}'"]);
    const forgotten = await harness.rememberedId({ text: 'Forgotten' });
    await harness.call(harness.operations.forget, { id: forgotten });

    const missing = await harness.run('keep', { fact: 'x', replaces: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a' });
    const refused = await harness.run('keep', { fact: 'x', replaces: forgotten });

    expect([missing, refused]).toMatchObject([
      {
        status: 'rejected',
        reason: 'conflict',
        kind: 'unworkable',
        detail: "There is no memory 019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a among the playbook's memories",
      },
      {
        status: 'rejected',
        reason: 'conflict',
        detail: `The memory ${forgotten} was forgotten, so no new version can replace it`,
      },
    ]);
  });

  it('is unavailable as memories_full once its scope keeps as many memories as it may', async () => {
    const harness = await keptBy([]);
    await harness.run('keep', { fact: 'One' });
    await harness.run('keep', { fact: 'Two' });

    expect(await harness.run('keep', { fact: 'Three' })).toMatchObject({
      status: 'rejected',
      reason: 'unavailable',
      kind: 'memories_full',
    });
  });
});

describe('the run of a memory function that recalls', () => {
  it('recalls by the words and the tags its templates render', async () => {
    const harness = memoryHarness();
    await harness.rememberedId({ text: 'The team ships on Thursdays', tags: ['releases'] });
    await harness.rememberedId({ text: 'The team ships on Fridays in summer', tags: ['summer'] });
    await harness.define('recall', recallDocument(["words: '{{ input.fact }}'", "tags: ['{{ input.about }}']"]));

    const ran = await harness.run('recall', { fact: 'TEAM ships', about: 'releases' });

    expect(ran).toMatchObject({
      output: { output: { memories: [{ text: 'The team ships on Thursdays' }] }, record: { examined: 2, recalled: 1 } },
    });
  });
});
