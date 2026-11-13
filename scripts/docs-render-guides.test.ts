import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { checkRenderGuides, renderGuidePages, runRenderGuides, writeRenderGuides } from './docs-render-guides.ts';

const publishedDocs = resolve(import.meta.dirname, '../docs');

function withTemporaryDocs(verify: (docs: string) => void): void {
  const docs = mkdtempSync(join(tmpdir(), 'auto-runtime-render-guides-'));
  try {
    verify(docs);
  } finally {
    rmSync(docs, { recursive: true });
  }
}

await test('the published pages are what the render targets generate', () => {
  assert.deepEqual(
    renderGuidePages.map(({ path }) => path),
    ['reference/render-slack.md'],
  );
  checkRenderGuides(publishedDocs);
  for (const { path, text } of renderGuidePages) {
    assert.equal(readFileSync(join(publishedDocs, path), 'utf8'), text);
  }
});

await test('generation creates the pages, and leaves them alone when they are current', () => {
  withTemporaryDocs((docs) => {
    assert.equal(writeRenderGuides(docs), 'updated');
    checkRenderGuides(docs);
    assert.equal(writeRenderGuides(docs), 'unchanged');
    writeFileSync(join(docs, 'reference/render-slack.md'), 'old\n');
    assert.equal(writeRenderGuides(docs), 'updated');
  });
});

await test('checking refuses a missing and a stale page without writing it', () => {
  withTemporaryDocs((docs) => {
    assert.throws(() => {
      checkRenderGuides(docs);
    }, /reference\/render-slack\.md\. Run pnpm docs:render-guides/u);
    assert.equal(existsSync(join(docs, 'reference/render-slack.md')), false);
    writeRenderGuides(docs);
    writeFileSync(join(docs, 'reference/render-slack.md'), 'old\n');
    assert.throws(() => {
      checkRenderGuides(docs);
    }, /stale/u);
  });
});

await test('the command writes, checks, and refuses any other argument', () => {
  withTemporaryDocs((docs) => {
    runRenderGuides([], docs);
    runRenderGuides(['--check'], docs);
    assert.throws(() => {
      runRenderGuides(['--fix'], docs);
    }, /Usage: pnpm docs:render-guides \[--check\]/u);
  });
});
