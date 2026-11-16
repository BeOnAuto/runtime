import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cellsOf, sentencesOfText } from './agent-text-sentences.ts';

await test('a text without Markdown is its sentences, as the server counts the sentences of a description', () => {
  assert.deepEqual(sentencesOfText('Counts the rows. Does it? It does! Release 1.2 keeps it.'), [
    { kind: 'words', source: 'Counts the rows.', heading: '' },
    { kind: 'words', source: 'Does it?', heading: '' },
    { kind: 'words', source: 'It does!', heading: '' },
    { kind: 'words', source: 'Release 1.2 keeps it.', heading: '' },
  ]);
});

await test('a heading is read as itself and names what follows it, and a list item or a quote drops its mark', () => {
  const text = [
    '# Bounds',
    '',
    'A run takes 1 MiB. It is refused past it.',
    '',
    '## The run ##',
    '- It waits.',
    '12. It ends.',
    '   * It is kept.',
    '> It is quoted.',
    '>',
    '#hashtag is a word.',
  ].join('\n');
  assert.deepEqual(sentencesOfText(text), [
    { kind: 'heading', source: 'Bounds', heading: 'Bounds' },
    { kind: 'words', source: 'A run takes 1 MiB.', heading: 'Bounds' },
    { kind: 'words', source: 'It is refused past it.', heading: 'Bounds' },
    { kind: 'heading', source: 'The run', heading: 'The run' },
    { kind: 'words', source: 'It waits.', heading: 'The run' },
    { kind: 'words', source: 'It ends.', heading: 'The run' },
    { kind: 'words', source: 'It is kept.', heading: 'The run' },
    { kind: 'words', source: 'It is quoted.', heading: 'The run' },
    { kind: 'words', source: '#hashtag is a word.', heading: 'The run' },
  ]);
});

await test('a table row is read whole, and its delimiter row not at all', () => {
  const text = ['## Limits', '| Bound | Limit |', '| --- | :---: |', '| Input | 1 MiB. As JSON. |'].join('\n');
  assert.deepEqual(sentencesOfText(text), [
    { kind: 'heading', source: 'Limits', heading: 'Limits' },
    { kind: 'row', source: '| Bound | Limit |', heading: 'Limits' },
    { kind: 'row', source: '| Input | 1 MiB. As JSON. |', heading: 'Limits' },
  ]);
});

await test('a line of an example is read as it stands, until the fence that opened it closes', () => {
  const text = [
    '## A function',
    '````markdown',
    '---',
    'model: gateway/a',
    '',
    '```chart line',
    '# Not a heading. Not two sentences.',
    '```',
    '````',
    'After it. Two sentences.',
    '~~~',
    '  indented: yes',
    '~~~~',
  ].join('\n');
  assert.deepEqual(sentencesOfText(text), [
    { kind: 'heading', source: 'A function', heading: 'A function' },
    { kind: 'example', source: '---', heading: 'A function' },
    { kind: 'example', source: 'model: gateway/a', heading: 'A function' },
    { kind: 'example', source: '```chart line', heading: 'A function' },
    { kind: 'example', source: '# Not a heading. Not two sentences.', heading: 'A function' },
    { kind: 'example', source: '```', heading: 'A function' },
    { kind: 'words', source: 'After it.', heading: 'A function' },
    { kind: 'words', source: 'Two sentences.', heading: 'A function' },
    { kind: 'example', source: '  indented: yes', heading: 'A function' },
  ]);
});

await test('the cells of a row are split at each bar that is not escaped', () => {
  assert.deepEqual(cellsOf('| `a \\| b` | 1 MiB |'), ['`a | b`', '1 MiB']);
  assert.deepEqual(cellsOf('  | One | Two \\|'), ['One', 'Two |']);
});
