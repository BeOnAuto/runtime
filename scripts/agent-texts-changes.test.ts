import assert from 'node:assert/strict';
import { test } from 'node:test';

import { changesBetween, inTurn, wordsShown } from './agent-texts-changes.ts';
import type { AgentTextsRecord, Tier } from './agent-texts-record.ts';

interface Given {
  readonly as: string;
  readonly text: string;
  readonly tier?: Tier;
  readonly on?: readonly string[];
}

const tiers = { '1': 'Always received.', '2': 'The onboarding path.', '3': 'Every other text.' };

function recordOf(given: readonly Given[]): AgentTextsRecord {
  return {
    tiers,
    texts: given.map(({ as, text, tier = 3, on = ['/mcp'] }) => ({
      tier,
      received: [{ as, on }],
      lines: text.split('\n'),
    })),
  };
}

const guideBefore = [
  '# Tally',
  '',
  '## Bounds',
  '',
  '| Bound | Limit |',
  '| --- | --- |',
  '| Input | 256 KiB as JSON |',
  '',
  'A run is refused past it. The operator sets it with `TALLY_MAX_INPUT`.',
  '',
  '```yaml',
  'model: gateway/openai/a',
  '```',
].join('\n');

const guideAfter = [
  '# Tally',
  '',
  '## Bounds',
  '',
  '| Bound | Limit |',
  '| --- | --- |',
  '| Input | 1 MiB as JSON |',
  '',
  'A run is refused past it, in words that give the limit.',
  '',
  '```yaml',
  'model: <gateway>/<model>',
  '```',
].join('\n');

const theListOfTally = [
  '## What an agent reads: before and after',
  '',
  '3 texts an agent reads changed. Each text below is named by where an agent receives it, then gives its tier, each sentence that changed, before and after, and its size.',
  '',
  'The tiers:',
  '',
  '- Tier 1. Always received.',
  '- Tier 3. Every other text.',
  '',
  '### tool tally: description',
  '',
  'Tier 1.',
  '',
  '- Before: Use it to count.',
  '',
  '  After: Use it to count rows.',
  '',
  'Size: 55 bytes before, 60 after, 5 more.',
  '',
  '### guide tally',
  '',
  'Tier 3.',
  '',
  'Under **Bounds**:',
  '',
  '- Before: Input · 256 KiB as JSON',
  '',
  '  After: Input · 1 MiB as JSON',
  '',
  '- Before: A run is refused past it.',
  '',
  '  After: A run is refused past it, in words that give the limit.',
  '',
  '- Before: The operator sets it with `TALLY_MAX_INPUT`.',
  '',
  '  After: removed',
  '',
  'Under **Bounds**, in an example:',
  '',
  '- Before: `model: gateway/openai/a`',
  '',
  '  After: `model: <gateway>/<model>`',
  '',
  'Size: 188 bytes before, 172 after, 16 fewer.',
  '',
  '### guide extra',
  '',
  'Tier 3.',
  '',
  'New: an agent did not receive this text before.',
  '',
  'Under **Extra**:',
  '',
  '- Before: not there',
  '',
  '  After: Extra',
  '',
  '- Before: not there',
  '',
  '  After: It is new.',
  '',
  'Size: 0 bytes before, 19 after, 19 more.',
  '',
  '### In total',
  '',
  'Every text an agent reads, each counted once: 270 bytes before, 278 after, 8 more.',
  '',
].join('\n');

await test('nothing an agent reads changed is said in one line, whatever else of the record changed', () => {
  const record = recordOf([{ as: 'guide tally', text: guideBefore }]);
  assert.equal(
    changesBetween({ before: record, after: { ...record, tiers: {} } }),
    'Nothing an agent reads changed.\n',
  );
});

await test('the list names each text an agent receives that changed, its tier, each sentence before and after, and the bytes', () => {
  const before = recordOf([
    { as: 'guide tally', text: guideBefore },
    { as: 'tool tally: description', tier: 1, text: 'Counts the rows. Use it to count. It answers the count.' },
    { as: 'instructions', tier: 1, text: 'Read the guide start first.' },
  ]);
  const after = recordOf([
    { as: 'guide tally', text: guideAfter },
    { as: 'tool tally: description', tier: 1, text: 'Counts the rows. Use it to count rows. It answers the count.' },
    { as: 'instructions', tier: 1, text: 'Read the guide start first.' },
    { as: 'guide extra', text: '# Extra\n\nIt is new.' },
  ]);
  assert.equal(changesBetween({ before, after }), theListOfTally);
});

await test('a text an agent no longer receives gives each of its sentences as removed', () => {
  const before = recordOf([{ as: 'guide old', text: 'It was here. Now it goes.' }]);
  const list = changesBetween({ before, after: recordOf([]) });
  assert.ok(list.includes('### guide old\n\nTier 3.\n\nRemoved: an agent no longer receives this text.\n'));
  assert.ok(list.includes('- Before: Now it goes.\n\n  After: removed\n'));
  assert.ok(list.includes('Size: 25 bytes before, 0 after, 25 fewer.'));
});

await test('words an agent already read elsewhere are not listed again, only where it now reads them or still does', () => {
  const guide = { as: 'guide tally', text: 'It counts.' };
  const attached = { as: 'prompt count: attached guide://tally', text: 'It counts.' };
  const gained = changesBetween({ before: recordOf([guide]), after: recordOf([guide, attached]) });
  assert.ok(gained.includes('### prompt count: attached guide://tally\n\nTier 3.\n\n'));
  assert.ok(gained.includes('Its words are not new: an agent read them before as guide tally.\n'));
  assert.ok(!gained.includes('Before: not there'));
  const lost = changesBetween({ before: recordOf([guide, attached]), after: recordOf([guide]) });
  assert.ok(lost.includes('An agent still reads the same words as guide tally.\n'));
  assert.ok(!lost.includes('After: removed'));
});

function inThreeTools(text: string): AgentTextsRecord {
  return recordOf([
    { as: 'tool b: argument a', text, tier: 1 },
    { as: 'tool a: argument a', text, tier: 1 },
    { as: 'tool c: argument a', text, tier: 1 },
  ]);
}

function inAGuideAndATool(text: string): AgentTextsRecord {
  return {
    tiers: {},
    texts: [
      { tier: 3, received: [{ as: 'guide a', on: ['/mcp'] }], lines: [text] },
      { tier: 1, received: [{ as: 'tool a: description', on: ['/mcp'] }], lines: [text] },
    ],
  };
}

await test('a text received in several places that changed in each is listed once, under the first place by name', () => {
  const list = changesBetween({
    before: inThreeTools('The rows, at most 256 KiB'),
    after: inThreeTools('The rows, at most 1 MiB'),
  });
  assert.ok(
    list.includes('### tool a: argument a\n\nTier 1. Also received as tool b: argument a and tool c: argument a.\n'),
  );
  assert.ok(list.startsWith('## What an agent reads: before and after\n\n1 text an agent reads changed.'));
});

await test('a text received in places of different tiers takes the highest, and a tier the record does not describe is its number', () => {
  const list = changesBetween({ before: inAGuideAndATool('It runs.'), after: inAGuideAndATool('It walks.') });
  assert.ok(list.includes('The tiers:\n\n- Tier 1.\n\n### guide a\n\nTier 1. Also received as tool a: description.\n'));
});

await test('a text that changed on some of the connections it is received on names those connections', () => {
  const on = ['/mcp', '/directory'];
  const before = recordOf([{ as: 'instructions', text: 'Read it.', tier: 1, on }]);
  const after: AgentTextsRecord = {
    tiers,
    texts: [
      { tier: 1, received: [{ as: 'instructions', on: ['/mcp'] }], lines: ['Read it first.'] },
      { tier: 1, received: [{ as: 'instructions', on: ['/directory'] }], lines: ['Read it.'] },
    ],
  };
  assert.ok(changesBetween({ before, after }).includes('### instructions, on /mcp\n'));
});

await test('a sentence written differently with the same words, and a text with only its spacing changed, say so', () => {
  const reworded = changesBetween({
    before: recordOf([{ as: 'guide a', text: 'Read [the guide](https://on.auto/a).' }]),
    after: recordOf([{ as: 'guide a', text: 'Read [the guide](https://on.auto/b).' }]),
  });
  assert.ok(reworded.includes('- Before: Read the guide.\n\n  After: the same words, formatted differently\n'));
  const spaced = changesBetween({
    before: recordOf([{ as: 'guide a', text: 'It runs. It ends.' }]),
    after: recordOf([{ as: 'guide a', text: 'It runs.\nIt ends.' }]),
  });
  assert.ok(spaced.includes('The words are the same; only spaces or line breaks changed.\n'));
  assert.ok(spaced.includes('Size: 17 bytes before, 17 after, the same.'));
});

await test('a text that names no heading gives an example without one', () => {
  const list = changesBetween({
    before: recordOf([{ as: 'prompt a: message', text: '```\nrun: a\n```' }]),
    after: recordOf([{ as: 'prompt a: message', text: '```\nrun: b\n```' }]),
  });
  assert.ok(list.includes('Tier 3.\n\nIn an example:\n\n- Before: `run: a`\n'));
});

await test('the words of a sentence show as they read, with names as code and nothing taken for Markdown or a mention', () => {
  assert.equal(
    wordsShown('Use **`list_models`** and [the guide](https://on.auto/g), at most 1 \\| 2 KiB.'),
    'Use `list_models` and the guide, at most 1 | 2 KiB.',
  );
  assert.equal(
    wordsShown('alk.<org>.<id> costs $5 ~ *more* than _x_ or MODEL_GATEWAYS, @team, a\\b, [x] &amp; R&D'),
    String.raw`alk.\<org>.\<id> costs \$5 \~ \*more\* than \_x\_ or MODEL_GATEWAYS, \@team, a\\b, \[x\] \&amp; R&D`,
  );
  assert.equal(wordsShown('Write `` `Hello` `` and ``a ` b``.'), 'Write `` `Hello` `` and ``a ` b``.');
  assert.equal(wordsShown('A stray ` mark.'), 'A stray \\` mark.');
});

await test('names in turn are joined with commas and a final and', () => {
  const lists: readonly (readonly string[])[] = [[], ['a'], ['a', 'b'], ['a', 'b', 'c']];
  assert.deepEqual(
    lists.map((names) => inTurn(names)),
    ['', 'a', 'a and b', 'a, b and c'],
  );
});
