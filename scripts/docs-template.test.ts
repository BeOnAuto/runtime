import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { parsedTemplate, templateEngine } from '@on.auto/definitions/template';
import { Result } from 'effect';

const docs = resolve(import.meta.dirname, '../docs');

const routes = [...readFileSync(join(docs, 'nav.json'), 'utf8').matchAll(/"link"\s*:\s*"([^"]+)"/gu)]
  .map((match: readonly string[]) => match[1])
  .filter((route) => route !== undefined);

const page = readFileSync(join(docs, 'reference/template.md'), 'utf8');

const theFiltersOfEveryTemplate =
  'A template may use the filters listed in [Templates](template.md#filters), the `templates` guide, the same in every template.';

const namesIn = (text: string): readonly string[] =>
  [...text.matchAll(/`([a-z_0-9]+)`/gu)]
    .map((match: readonly string[]) => match[1])
    .filter((name) => name !== undefined);

const standardFilters = namesIn(
  page.match(/^Liquid's standard data and string filters are available: .+$/mu)?.[0] ?? '',
);

const addedFilters = [...page.matchAll(/^\| `([a-z_]+)` +\| /gmu)]
  .map((match: readonly string[]) => match[1])
  .filter((name) => name !== undefined);

await test('the reference of templates follows the output shapes in the navigation', () => {
  assert.equal(routes.indexOf('/reference/template'), routes.indexOf('/reference/output-shapes') + 1);
  assert.match(page, /^# Templates$/mu);
  assert.match(page, /^## Filters$/mu);
});

await test('every filter the reference of templates lists is one a template may use', () => {
  const engine = templateEngine();
  assert.equal(standardFilters.length, 67);
  assert.deepEqual(addedFilters, ['money', 'clip', 'words']);
  for (const filter of [...standardFilters, ...addedFilters]) {
    assert.ok(Result.isSuccess(parsedTemplate(engine, `{{ input.a | ${filter} }}`, 1)), `No template takes ${filter}`);
  }
});

await test('the formats that hold a template lead to its filters in the same words, and list none of their own', () => {
  for (const format of ['reasoning-format.md', 'interaction-format.md']) {
    const guide = readFileSync(join(docs, 'reference', format), 'utf8');
    assert.ok(guide.includes(theFiltersOfEveryTemplate), `${format} needs a link to the filters of every template`);
    assert.doesNotMatch(
      guide,
      /^Liquid's standard data and string filters|^\| `money` +\| /mu,
      `${format} lists filters`,
    );
  }
});
