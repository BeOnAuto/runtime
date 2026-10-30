import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { outputShapeNamed, outputShapeNames } from '@on.auto/definitions';

const docs = resolve(import.meta.dirname, '../docs');

const routes = [...readFileSync(join(docs, 'nav.json'), 'utf8').matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);

const page = readFileSync(join(docs, 'reference/output-shapes.md'), 'utf8');

await test('the reference of output shapes follows the formats in the navigation', () => {
  assert.ok(routes.includes('/reference/output-shapes'));
  assert.equal(routes.indexOf('/reference/output-shapes'), routes.indexOf('/reference/workflow-format') + 1);
  assert.match(page, /^# Output shapes$/mu);
});

await test('the reference of output shapes gives each shape the runtime owns, under its name and its $id', () => {
  const headings = [...page.matchAll(/^### (\w+)$/gmu)].map((match: readonly string[]) => match[1]);
  assert.deepEqual(headings, outputShapeNames());
  for (const name of outputShapeNames()) {
    assert.equal(outputShapeNamed(name)?.schema['$id'], `https://on.auto/shapes/${name}`);
  }
  assert.ok(page.includes('`https://on.auto/shapes/` followed by the shape'));
  assert.ok(page.includes('`details.shape` is the shape'));
});

await test('the formats that take a shape name output.shape and lead to its reference', () => {
  for (const format of ['reasoning-format.md', 'computation-format.md', 'workflow-format.md']) {
    const guide = readFileSync(join(docs, 'reference', format), 'utf8');
    assert.match(guide, /^\| `output\.shape` +\| /mu, `${format} needs a row for output.shape`);
    assert.ok(guide.includes('](output-shapes.md)'), `${format} needs a link to the output shapes`);
  }
  assert.ok(readFileSync(join(docs, 'reference/http.md'), 'utf8').includes('`details.shape`'));
});

await test('the word shape is on the terminology page', () => {
  assert.match(
    readFileSync(join(docs, 'concepts/terminology.md'), 'utf8'),
    /^\| Shape +\| A JSON Schema the runtime owns/mu,
  );
});
