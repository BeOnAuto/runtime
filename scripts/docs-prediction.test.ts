import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

const routes = [...readFileSync(join(docs, 'nav.json'), 'utf8').matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);

const format = readFileSync(join(docs, 'reference/prediction-format.md'), 'utf8');

await test('prediction functions are available in every runtime, with their format beside the other formats', () => {
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  assert.ok(functions.includes('reasoning, interaction, prediction, recall and computation functions are available'));
  assert.ok(functions.includes('](../reference/prediction-format.md)'));
  assert.ok(routes.indexOf('/reference/interaction-format') < routes.indexOf('/reference/prediction-format'));
  assert.ok(routes.indexOf('/reference/prediction-format') < routes.indexOf('/reference/recall-format'));
  assert.ok(routes.indexOf('/reference/prediction-format') < routes.indexOf('/reference/workflow-format'));
  assert.ok(format.includes('Prediction functions are available in every runtime'));
});

await test('the format of prediction functions sets out the document, the dataset, the forecaster and a question, in that order', () => {
  assert.match(
    format,
    /^## How a prediction function forecasts\n[\s\S]*^## A function document\n[\s\S]*^## Fields\n[\s\S]*^### The input and the output\n[\s\S]*^### A total to the end of a period\n[\s\S]*^## The dataset\n[\s\S]*^## The forecaster\n[\s\S]*^## A question\n[\s\S]*^## How a run ends\n[\s\S]*^## Bounds\n[\s\S]*^## In a workflow\n[\s\S]*^## The overview\n[\s\S]*^## Availability\n/mu,
  );
  assert.match(format, /^\| `predicts\.coverage` +\| /mu);
  assert.match(format, /^\| `predicts\.accumulates` +\| /mu);
});

await test('the forecaster is set out by its methods, its backtest, its range and its refusal of too short a history', () => {
  assert.match(
    format,
    /^## The forecaster\n[\s\S]*^### The methods\n[\s\S]*^### The backtest\n[\s\S]*^### The range\n[\s\S]*^### Too short a history\n/mu,
  );
  for (const method of ['level-adjusted-seasonal-naive', 'seasonal-naive', 'persistence', 'run-rate']) {
    assert.match(format, new RegExp(`^\\| \`${method}\` +\\| `, 'mu'), `The methods need ${method}`);
  }
  assert.ok(format.includes('`N + h + 2` periods'));
  assert.ok(format.includes('A total is backtested as a total'));
  assert.ok(format.includes('`conflict` of the kind `history_too_short`'));
  for (const field of ['method', 'coverage', 'season', 'k', 'history.periods', 'history.origins']) {
    assert.match(format, new RegExp(`^\\| \`${field.replace('.', '\\.')}\` +\\| `, 'mu'), `The record needs ${field}`);
  }
});

await test('the words of prediction are on the terminology page', () => {
  const terminology = readFileSync(join(docs, 'concepts/terminology.md'), 'utf8');
  for (const term of ['Dataset', 'Forecaster', 'Backtest', 'Range', 'Coverage']) {
    assert.match(terminology, new RegExp(`^\\| ${term} +\\| `, 'mu'), `The terminology page needs ${term}`);
  }
});
