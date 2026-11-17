import { Conflict, InvalidInput } from '@on.auto/operations';
import { heldForATest, keptForATest } from '@on.auto/operations/testing';
import { Effect, Exit, Result, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { inputReadBy, unreadAssetOf } from './inside-reads.ts';
import { templateEngine } from './template-engine.ts';
import { parsedTemplate } from './template-parsing.ts';

const engine = templateEngine();

const page = keptForATest('019a5b12-0000-7000-8000-000000000061', 'text/plain', 'the page');
const other = keptForATest('019a5b12-0000-7000-8000-000000000062', 'text/plain', 'another page');

const bound = { most: 1000, unit: 'characters', reader: 'a template holds', remedy: 'give it less' } as const;

async function readBy(template: string, input: Schema.Json) {
  const holding = heldForATest([page, other]);
  const { variables } = Result.getOrThrow(parsedTemplate(engine, template, 1));
  const exit = await Effect.runPromiseExit(
    inputReadBy(variables, input, { holding, playbook: { org: 'acme', playbook: 'alpha' }, bound }),
  );
  return { exit, opened: holding.opened() };
}

describe('the assets a template reads inside', () => {
  it('are those at or within a place it reads of its input, and those it reads a part of', async () => {
    const input = { page: page.reference, nested: { other: other.reference } };

    expect(await readBy('{{ input.page.size }} {{ input.nested | json }}', input)).toEqual({
      exit: Exit.succeed({ page: 'the page', nested: { other: 'another page' } }),
      opened: 2,
    });
  });

  it('are every asset of the input where it reads the input by a name it works out, or the input whole', async () => {
    const input = { page: page.reference, other: other.reference };

    expect((await readBy('{{ input[now] }}', input)).opened).toBe(2);
    expect((await readBy('{{ input | json }}', input)).opened).toBe(2);
  });

  it('are none where it reads only other places, or variables that are not its input', async () => {
    const input = { page: page.reference, other: other.reference, title: 'Prices' };

    expect(await readBy('{{ input.title }} {{ today }}', input)).toEqual({ exit: Exit.succeed(input), opened: 0 });
  });

  it('read through a list where it takes the first or the last of it', async () => {
    expect((await readBy('{{ input.pages.first }}', { pages: [page.reference, other.reference] })).opened).toBe(2);
  });
});

describe('an asset that is not read', () => {
  it('is refused as unworkable where it is too large, and as invalid input otherwise', () => {
    expect([
      unreadAssetOf({ because: 'too_large', pointer: '/page', detail: 'Too large' }),
      unreadAssetOf({ because: 'asset_unusable', pointer: '/page', detail: 'Expired' }),
    ]).toEqual([
      new Conflict({ detail: 'Too large', kind: 'unworkable' }),
      new InvalidInput({ detail: 'Expired', issues: [{ pointer: '/page', detail: 'Expired' }] }),
    ]);
  });
});
