import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Sentence } from './agent-text-sentences.ts';
import { sentenceChangesBetween } from './sentence-changes.ts';

function said(source: string): Sentence {
  return { kind: 'words', source, heading: '' };
}

function row(source: string): Sentence {
  return { kind: 'row', source, heading: '' };
}

function sourcesOf(changes: ReturnType<typeof sentenceChangesBetween>): readonly (readonly [string, string])[] {
  return changes.map(({ before, after }) => [before?.source ?? 'not there', after?.source ?? 'removed']);
}

await test('the same sentences in the same order are no change', () => {
  assert.deepEqual(
    sentenceChangesBetween([said('It runs.'), said('It ends.')], [said('It runs.'), said('It ends.')]),
    [],
  );
});

await test('a sentence changed in place is given before and after, and one taken out or put in on its own', () => {
  const before = [said('It runs.'), said('It takes 256 KiB.'), said('It is kept.'), said('It ends.')];
  const after = [said('It runs.'), said('It takes 1 MiB.'), said('It ends.'), said('It is told.')];
  assert.deepEqual(sourcesOf(sentenceChangesBetween(before, after)), [
    ['It takes 256 KiB.', 'It takes 1 MiB.'],
    ['It is kept.', 'removed'],
    ['not there', 'It is told.'],
  ]);
});

await test('among several sentences changed together, each is given beside the one most like it, in order', () => {
  const before = [
    said('A run takes 256 KiB of input.'),
    said('Calls wait under one run.'),
    said('A run lasts 30 days.'),
  ];
  const after = [
    said('A step reads its tools.'),
    said('A run takes 1 MiB of input.'),
    said('A run lasts as long as allowed.'),
  ];
  assert.deepEqual(sourcesOf(sentenceChangesBetween(before, after)), [
    ['not there', 'A step reads its tools.'],
    ['A run takes 256 KiB of input.', 'A run takes 1 MiB of input.'],
    ['Calls wait under one run.', 'removed'],
    ['A run lasts 30 days.', 'A run lasts as long as allowed.'],
  ]);
});

await test('two rows of a table are the same row changed when their first cells are the same, however else they differ', () => {
  const before = [row('| Memory | 256 MiB |'), row('| Stack | 1 MiB |')];
  const after = [
    row('| Memory | What the runtime gives a sandbox, which the refusal names |'),
    row('| Work | 200 million steps |'),
  ];
  assert.deepEqual(sourcesOf(sentenceChangesBetween(before, after)), [
    ['| Memory | 256 MiB |', '| Memory | What the runtime gives a sandbox, which the refusal names |'],
    ['| Stack | 1 MiB |', 'removed'],
    ['not there', '| Work | 200 million steps |'],
  ]);
});

await test('one sentence that takes the place of another is given beside it, alike or not, and sentences without words are alike', () => {
  assert.deepEqual(sourcesOf(sentenceChangesBetween([said('It runs.')], [said('Nothing else.')])), [
    ['It runs.', 'Nothing else.'],
  ]);
  assert.deepEqual(
    sourcesOf(sentenceChangesBetween([said('—'), said('It runs.')], [said('…'), said('Nobody walks.')])),
    [
      ['—', '…'],
      ['It runs.', 'removed'],
      ['not there', 'Nobody walks.'],
    ],
  );
});

await test('the same words as an example and as a sentence are not the same', () => {
  const asAnExample: Sentence = { kind: 'example', source: 'It runs.', heading: '' };
  assert.deepEqual(sourcesOf(sentenceChangesBetween([said('It runs.')], [asAnExample])), [['It runs.', 'It runs.']]);
});
