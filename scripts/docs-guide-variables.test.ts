import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import type { GuideVariables } from '@on.auto/definitions';

import {
  checkGuideVariables,
  declaredByDefault,
  guidePagesIn,
  runGuideVariables,
  writeGuideVariables,
} from './docs-guide-variables.ts';

const publishedDocs = resolve(import.meta.dirname, '../docs');

const declared: GuideVariables = { 'example.most_image': { value: '20 MiB', default: '20 MiB' } };

const named = '# Format\n\nAn image holds at most <span data-variable="example.most_image">20 MiB</span>.\n';

function withTemporaryDocs(pages: Readonly<Record<string, string>>, verify: (docs: string) => void): void {
  const docs = mkdtempSync(join(tmpdir(), 'auto-runtime-guide-variables-'));
  try {
    for (const [page, text] of Object.entries({ 'concepts/terminology.md': '# Terminology\n', ...pages })) {
      mkdirSync(dirname(join(docs, page)), { recursive: true });
      writeFileSync(join(docs, page), text);
    }
    verify(docs);
  } finally {
    rmSync(docs, { recursive: true });
  }
}

await test('the published pages name only values a server declares, each with its default, and type none where its value belongs', () => {
  assert.deepEqual(
    Object.entries(declaredByDefault).map(([name, written]: readonly [string, { readonly default: string }]) => [
      name,
      written.default,
    ]),
    [
      ['generation.most_image', '20 MiB'],
      ['generation.most_audio', '50 MiB'],
      ['generation.most_kept', '2,048 MiB'],
      ['generation.kept', '90 days'],
      ['generation.bounds_changed_by', 'can be changed only by whoever runs the server'],
      ['generation.example_image_model', 'gateway/openai/gpt-image-2'],
      ['generation.example_audio_model', 'gateway/openai/gpt-4o-mini-tts'],
      ['computation.most_memory', '256 MiB'],
      ['computation.bounds_changed_by', 'are fixed on this server'],
      ['interaction.most_call_arguments', '16 MiB'],
      ['interaction.most_open_requests', '10,000 at once'],
      ['interaction.bounds_changed_by', 'can be changed only by whoever runs the server'],
      ['lookup.most_call_arguments', '16 MiB'],
      ['lookup.bounds_changed_by', 'can be changed only by whoever runs the server'],
      ['workflow.longest_run', '30 days from its start'],
      ['workflow.bounds_changed_by', 'can be changed only by whoever runs the server'],
    ],
  );
  checkGuideVariables(publishedDocs, declaredByDefault);
  const guidePages = guidePagesIn(publishedDocs);
  assert.ok(guidePages.includes('concepts/terminology.md'));
  assert.ok(guidePages.includes('reference/generation-format.md'));
  assert.ok(guidePages.includes('reference/render-slack.md'));
  assert.ok(guidePages.includes('reference/events.md'));
  assert.equal(guidePages.includes('reference/http.md'), false);
});

await test('writing puts each default in its place, and leaves alone a page that holds them', () => {
  withTemporaryDocs({ 'reference/example-format.md': named.replace('>20 MiB<', '>10 MiB<') }, (docs) => {
    assert.equal(writeGuideVariables(docs, declared), 'updated');
    assert.equal(readFileSync(join(docs, 'reference/example-format.md'), 'utf8'), named);
    assert.equal(writeGuideVariables(docs, declared), 'unchanged');
    checkGuideVariables(docs, declared);
  });
});

await test('checking refuses another default and a value no server declares, and names the one command that writes the defaults', () => {
  withTemporaryDocs({ 'reference/example-format.md': named.replace('>20 MiB<', '>10 MiB<') }, (docs) => {
    assert.throws(() => {
      checkGuideVariables(docs, declared);
    }, /^Error: The values the guides name are out of step with the server\. pnpm docs:guide-variables writes each default\. reference\/example-format\.md: The line .* writes "10 MiB" as example\.most_image, whose default is "20 MiB"\.$/u);
    assert.throws(() => {
      checkGuideVariables(docs, {});
    }, /names the value example\.most_image, which this server does not declare\.$/u);
  });
});

await test('checking refuses a default typed where its value belongs on a page served as a guide, and not on another page', () => {
  const typed = `${named}\nA reference holds at most 20 MiB too.\n`;
  withTemporaryDocs({ 'reference/example-format.md': typed, 'guides/images.md': typed }, (docs) => {
    assert.throws(() => {
      checkGuideVariables(docs, declared);
    }, /reference\/example-format\.md types "20 MiB", the default of example\.most_image, where its value belongs\.$/u);
  });
  withTemporaryDocs({ 'reference/example-format.md': named, 'guides/images.md': typed }, (docs) => {
    checkGuideVariables(docs, declared);
  });
});

await test('the command writes, checks, and refuses any other argument', () => {
  withTemporaryDocs({ 'reference/example-format.md': named }, (docs) => {
    runGuideVariables([], docs, declared);
    runGuideVariables(['--check'], docs, declared);
    assert.throws(() => {
      runGuideVariables(['--fix'], docs, declared);
    }, /Usage: pnpm docs:guide-variables \[--check\]/u);
  });
});
