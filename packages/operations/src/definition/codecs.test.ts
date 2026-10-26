import { Effect, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCommand, defineQuery, takesNoBody, type OfferedLink } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toOrg, toPlaybook } from '../testing/harness.ts';
import { holdTree } from '../testing/misbehaving.ts';
import { addNote, listNotes } from '../testing/notes.ts';

const NoInput = Schema.Record(Schema.String, Schema.Never);

const toAlpha = toPlaybook('acme', 'alpha');

const inspect = defineQuery('playbook', {
  name: 'inspect',
  title: 'Inspect',
  description: 'Takes keys that need escaping in a JSON Pointer.',
  route: { method: 'GET', path: '/inspect' },
  inputSchema: Schema.Struct({
    nested: Schema.optionalKey(
      Schema.Struct({ 'a/b': Schema.optionalKey(Schema.Int), 'c~d': Schema.optionalKey(Schema.Int) }),
    ),
    items: Schema.optionalKey(Schema.Array(Schema.Int)),
  }),
  outputSchema: Schema.Record(Schema.String, Schema.Never),
  reasons: [],
  handle: () => Effect.succeed({}),
});

function treeNested(depth: number): unknown {
  return JSON.parse(`${'{"children":['.repeat(depth)}${']}'.repeat(depth)}`);
}

describe('the input of a call', () => {
  it('is rejected with a pointer to every problem', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(dispatcher.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'Anvil', 'a/b': 1 }))),
    ).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [
        { detail: 'Expected no excess property', pointer: '/a~1b' },
        { detail: 'Expected a string matching the RegExp ^[a-z][a-z0-9-]{0,31}$', pointer: '/name' },
        { detail: 'Missing key', pointer: '/text' },
      ],
    });
  });

  it('points into nested fields and items, escaping / and ~', async () => {
    const { dispatcher, run } = harness();
    const input = { nested: { 'a/b': 'x', 'c~d': 'y' }, items: [1, 'two'] };

    expect(await run(dispatcher.dispatchToPlaybook(inspect.registration, toAlpha(acmeAdmin, input)))).toMatchObject({
      issues: [{ pointer: '/nested/a~1b' }, { pointer: '/nested/c~0d' }, { pointer: '/items/1' }],
    });
  });
});

describe('an input that cannot be decoded', () => {
  it('is rejected with at most one hundred issues', async () => {
    const { dispatcher, run } = harness();
    const manyUnknownKeys = Object.fromEntries(Array.from({ length: 150 }, (_unused, index) => [`key${index}`, index]));

    expect(
      await run(dispatcher.dispatchToPlaybook(inspect.registration, toAlpha(acmeAdmin, manyUnknownKeys))),
    ).toMatchObject({
      reason: 'invalid_input',
      issues: Array.from({ length: 100 }, () => ({ detail: 'Expected no excess property' })),
    });
  });

  it('is rejected, without failing the call, when it is nested too deeply to decode', async () => {
    const { dispatcher, reported, run } = harness();

    expect(
      await run(dispatcher.dispatchToPlaybook(holdTree.registration, toAlpha(acmeAdmin, { tree: treeNested(10) }))),
    ).toEqual({
      status: 'succeeded',
      output: { held: true },
    });
    expect(
      await run(dispatcher.dispatchToPlaybook(holdTree.registration, toAlpha(acmeAdmin, { tree: treeNested(5_000) }))),
    ).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input is nested too deeply',
      issues: [{ detail: 'The input is nested too deeply', pointer: '' }],
    });
    expect(reported()).toEqual([]);
  });
});

function listing(input: unknown) {
  const { dispatcher, run } = harness();
  return run(
    dispatcher.dispatchToPlaybook(listNotes.registration, { ...toAlpha(acmeAdmin, input), encoding: 'strings' }),
  );
}

describe('the input of a call as strings', () => {
  it('is decoded through the input schema, as from a query string', async () => {
    expect(await listing({ limit: '1' })).toEqual({ status: 'succeeded', output: { notes: [] } });
    expect(await listing({ limit: 'many' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/limit' }],
    });
  });

  it('rejects keys the schema does not declare, pointing at every problem', async () => {
    expect(await listing({ limit: 'many', other: 'x' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ detail: 'Expected no excess property', pointer: '/other' }, { pointer: '/limit' }],
    });
  });
});

const Linked = Schema.Struct({ id: Schema.String, opened: Schema.optionalKey(Schema.String), at: Schema.Date });

const linked = {
  title: 'Link',
  description: 'Links.',
  inputSchema: NoInput,
  reasons: [],
  name: 'link',
  route: { method: 'DELETE', path: '/link' },
  outputSchema: Linked,
  handle: () => Effect.succeed({ id: 'page-1', opened: 'https://page.example/open', at: new Date(0) }),
} as const;

function linkOf({ opened, at }: typeof Linked.Type) {
  return opened === undefined ? undefined : { message: `Open it before ${at.toISOString()}`, url: opened };
}

const answeredAgain = {
  idOf: ({ id }: typeof Linked.Type) => id,
  read: ({ id, url }: OfferedLink) => Effect.succeed({ id, opened: `${url}#again`, at: new Date(1000) }),
};

const linking = defineCommand('org', { ...linked, linkToOpen: linkOf, answerAfterTheLink: answeredAgain });

const offered = { id: 'page-1', url: 'https://page.example/open' };

function answeringAfter(link: OfferedLink) {
  return Option.getOrThrow(Option.fromNullishOr(linking.registration.link)).answerAfter(link);
}

describe('the link a registration asks a person to open', () => {
  it('is read from its output as JSON gives it, with the id of what it is for, and is not there unless its definition gives one', () => {
    const output = { id: 'page-1', opened: 'https://page.example/open', at: '1970-01-01T00:00:00.000Z' };

    expect(linking.registration.link?.toOpen(output)).toEqual({
      message: 'Open it before 1970-01-01T00:00:00.000Z',
      url: 'https://page.example/open',
    });
    expect(linking.registration.link?.toOpen({ id: 'page-1', at: '1970-01-01T00:00:00.000Z' })).toBeUndefined();
    expect(linking.registration.link?.idOf(output)).toBe('page-1');
    expect(addNote.registration.link).toBeUndefined();
  });

  it('answers the retry after it with what its read gives, under the input of the call', async () => {
    const { dispatcher, run } = harness();
    const toAcme = toOrg('acme');

    expect(await run(dispatcher.dispatchToOrg(answeringAfter(offered), toAcme(acmeAdmin)))).toEqual({
      status: 'succeeded',
      output: { id: 'page-1', opened: 'https://page.example/open#again', at: '1970-01-01T00:00:01.000Z' },
    });
    expect(await run(dispatcher.dispatchToOrg(answeringAfter(offered), toAcme(acmeAdmin, { other: 1 })))).toMatchObject(
      { status: 'rejected', reason: 'invalid_input' },
    );
  });

  it('is refused where a definition gives the link without the answer after it, or that answer without the link', () => {
    const halfLinked = 'The operation link gives one of linkToOpen and answerAfterTheLink without the other';

    expect(() => defineCommand('org', { ...linked, linkToOpen: linkOf })).toThrow(halfLinked);
    expect(() => defineCommand('org', { ...linked, answerAfterTheLink: answeredAgain })).toThrow(halfLinked);
  });
});

describe('a route', () => {
  it('takes its input outside a body when it is a GET or a DELETE, and in its body when it is a POST or a PUT', () => {
    expect((['GET', 'DELETE', 'POST', 'PUT'] as const).map((method) => takesNoBody({ method }))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});
