import { describe, expect, it } from 'vitest';

import { memoryHarness, recallDocument, rememberDocument } from '../testing/index.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const wordsPastTheBound = 'x'.repeat(1001);

const tooManyWords = 'The words to recall by hold at most 1,000 characters, and these hold 1,001';

describe('the tags of a memory, written more than once', () => {
  it('are kept once each, whether remember is asked them, a document writes them or a run renders them', async () => {
    const harness = memoryHarness();
    await harness.call(harness.operations.remember, { text: 'Asked', tags: ['team', 'team', 'releases'] });
    const saved = await harness.define('keep', rememberDocument(["tags: [team, team, '{{ input.about }}']"]));
    const ran = await harness.run('keep', { fact: 'Ran', about: 'team' });
    const tags = (await harness.rowsOf(alpha)).map(({ row }) => row['tags']);

    expect([saved, ran]).toMatchObject([{ status: 'succeeded' }, { status: 'succeeded' }]);
    expect(tags).toHaveLength(2);
    expect(tags).toEqual(expect.arrayContaining(['["team","releases"]', '["team"]']));
  });
});

describe('the words a recall reads, within their bound', () => {
  it('are at most 1,000 characters, whether recall is asked them, a document writes them or a run renders them', async () => {
    const harness = memoryHarness();
    await harness.define('recall', recallDocument(["words: '{{ input.fact }}'"]));

    const within = await harness.call(harness.operations.recall, { words: 'x'.repeat(1000) });
    const asked = await harness.call(harness.operations.recall, { words: wordsPastTheBound });
    const saved = await harness.define('recall-too-much', recallDocument([`words: ${wordsPastTheBound}`]));
    const ran = await harness.run('recall', { fact: wordsPastTheBound });

    expect(within).toMatchObject({ status: 'succeeded', output: { memories: [] } });
    expect(asked).toMatchObject({ status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/words' }] });
    expect(saved).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/source', detail: `Line 9, /recall/words: ${tooManyWords}` }],
    });
    expect(ran).toMatchObject({ status: 'rejected', reason: 'conflict', kind: 'unworkable', detail: tooManyWords });
  });
});
