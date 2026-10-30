import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const docs = resolve(import.meta.dirname, '../docs');

const routes = [...readFileSync(join(docs, 'nav.json'), 'utf8').matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);

await test('prediction functions are available in every runtime, with their format beside the other formats', () => {
  const functions = readFileSync(join(docs, 'concepts/functions.md'), 'utf8');
  const format = readFileSync(join(docs, 'reference/prediction-format.md'), 'utf8');
  assert.ok(functions.includes('reasoning, interaction, prediction, recall and computation functions are available'));
  assert.ok(functions.includes('](../reference/prediction-format.md)'));
  assert.ok(routes.indexOf('/reference/interaction-format') < routes.indexOf('/reference/prediction-format'));
  assert.ok(routes.indexOf('/reference/prediction-format') < routes.indexOf('/reference/recall-format'));
  assert.ok(routes.indexOf('/reference/prediction-format') < routes.indexOf('/reference/workflow-format'));
  assert.match(
    format,
    /^## A question\n[\s\S]*^## How a run ends\n[\s\S]*^## Bounds\n[\s\S]*^## In a workflow\n[\s\S]*^## Availability\n/mu,
  );
  assert.ok(format.includes('Prediction functions are available in every runtime'));
});

await test('the guide of prediction functions gives a trainer its path, and an agent that cannot run code the environment it needs', () => {
  const format = readFileSync(join(docs, 'reference/prediction-format.md'), 'utf8');
  assert.match(
    format,
    /^### The trainer's path\n\nA trainer is whoever fits the model: a person, or any agent with an environment that runs code/mu,
  );
  assert.match(
    format,
    /^2\. Read the brief and the training rows over the routes below, sending the key as `Authorization: Bearer <key>`\.$/mu,
  );
  assert.match(
    format,
    /^6\. Answer the request, .* through the tool `answer_interaction`, or over HTTP alone with `POST \/v1\/orgs\/\{org\}\/playbooks\/\{playbook\}\/runs\/\{run_id\}\/answer`/mu,
  );
  assert.match(format, /^### Sending a build through an interaction function$/mu);
  assert.ok(
    format.includes(
      'An agent that can only call tools, as an agent connected to the runtime over MCP alone is, cannot train',
    ),
  );
  assert.ok(format.includes('It needs an environment that runs code beside it'));
  assert.match(format, /^\| `predicts\.accumulates` +\| /mu);
  assert.match(format, /^### A total to the end of a period$/mu);
});

await test('the words of prediction are on the terminology page', () => {
  const terminology = readFileSync(join(docs, 'concepts/terminology.md'), 'utf8');
  for (const term of ['Dataset', 'Brief', 'Build', 'Trainer', 'Candidate', 'Card', 'Shadow', 'Active version']) {
    assert.match(terminology, new RegExp(`^\\| ${term} +\\| `, 'mu'), `The terminology page needs ${term}`);
  }
  assert.ok(terminology.includes("a function's versions are numbered from 1, apart from the versions of its document"));
});
