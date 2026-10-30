import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

const routes = [...readFileSync(join(docs, 'nav.json'), 'utf8').matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);

await test('recall functions are available in every runtime, with their format beside the other formats', () => {
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  const history = readFileSync(join(docs, 'concepts/history-and-dream.md'), 'utf8');
  const format = readFileSync(join(docs, 'reference/recall-format.md'), 'utf8');
  assert.ok(functions.includes('reasoning, interaction, prediction, recall and computation functions are available'));
  assert.ok(functions.includes('](../reference/recall-format.md)'));
  assert.ok(history.includes('Every runtime runs recall functions'));
  assert.ok(routes.indexOf('/reference/prediction-format') < routes.indexOf('/reference/recall-format'));
  assert.ok(routes.indexOf('/reference/recall-format') < routes.indexOf('/reference/computation-format'));
  assert.ok(routes.indexOf('/reference/recall-format') < routes.indexOf('/reference/workflow-format'));
  assert.ok(format.includes('Recall functions are available in every runtime.'));
  assert.ok(format.includes('A run never waits for the view'));
});
