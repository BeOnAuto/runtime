import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCommand, sizeBoundCheck } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { capturedLogs } from '../testing/captured-logs.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { holdTree } from '../testing/misbehaving.ts';

const anyWords: unknown = expect.any(String);

const toAlpha = toPlaybook('acme', 'alpha');

function withinFourteenCharacters(value: Schema.Json): true | string {
  return JSON.stringify(value).length <= 14 ? true : 'It takes more than 14 characters';
}

function textWithoutSpaces(values: { readonly [key: string]: Schema.Json }) {
  return Object.entries(values).flatMap(([key, value]: readonly [string, Schema.Json]) =>
    typeof value === 'string' && /\s/u.test(value) ? [{ path: [key], issue: 'Expected text without spaces' }] : [],
  );
}

const Shelved = Schema.Struct({
  label: Schema.optionalKey(Schema.String),
  code: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-z]+$/u))),
  anything: Schema.optionalKey(Schema.Json),
  bounded: Schema.optionalKey(Schema.Json.check(sizeBoundCheck(withinFourteenCharacters))),
  extras: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json).check(Schema.makeFilter(textWithoutSpaces))),
  choice: Schema.optionalKey(
    Schema.Union([Schema.String.check(Schema.isPattern(/^[a-z]+$/u)), Schema.Array(Schema.String)]),
  ),
  either: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  count: Schema.optionalKey(Schema.Int),
  tags: Schema.optionalKey(Schema.Array(Schema.String)),
  rows: Schema.optionalKey(Schema.Array(Schema.Struct({ size: Schema.Int }))),
  entry: Schema.optionalKey(
    Schema.Struct({ headers: Schema.Record(Schema.String, Schema.String), note: Schema.optionalKey(Schema.String) }),
  ),
});

const shelve = defineCommand('playbook', {
  name: 'shelve',
  title: 'Shelve',
  description: 'Answers its input as it took it.',
  route: { method: 'POST', path: '/shelve' },
  inputSchema: Shelved,
  outputSchema: Shelved,
  reasons: [],
  handle: (taken) => Effect.succeed(taken),
});

function shelving(input: unknown, encoding: 'json' | 'strings' = 'json') {
  const { dispatcher, run } = harness();
  return run(dispatcher.dispatchToPlaybook(shelve.registration, { ...toAlpha(acmeAdmin, input), encoding }));
}

function refusedAt(...pointers: readonly string[]): unknown {
  return {
    status: 'rejected',
    reason: 'invalid_input',
    detail: anyWords,
    issues: pointers.map((pointer) => ({ detail: anyWords, pointer })),
  };
}

function treeNested(depth: number): unknown {
  return JSON.parse(`${'{"children":['.repeat(depth)}${']}'.repeat(depth)}`);
}

describe('an argument given as JSON text, where the input schema takes the value it holds', () => {
  it('is taken as given when the input schema takes it, so an argument declared as text or as any JSON value keeps text that holds JSON', async () => {
    const asGiven = { label: '{"a":1}', anything: '[1,2]', tags: ['["red"]'], entry: { headers: { accept: '{}' } } };

    expect(await shelving(asGiven)).toEqual({ status: 'succeeded', output: asGiven });
  });

  it('is taken as the value its text holds, at any depth and at several places at once', async () => {
    expect([
      await shelving({ tags: '["red","blue"]', entry: { headers: '{"accept":"json"}' } }),
      await shelving({ entry: '{"headers":{},"note":"kept"}', rows: [{ size: 1 }, '{"size":2}'], either: '["a"]' }),
    ]).toEqual([
      { status: 'succeeded', output: { tags: ['red', 'blue'], entry: { headers: { accept: 'json' } } } },
      {
        status: 'succeeded',
        output: { entry: { headers: {}, note: 'kept' }, rows: [{ size: 1 }, { size: 2 }], either: ['a'] },
      },
    ]);
  });

  it('logs one line for a call, with the operation and the places it read a value from text at, at most ten of them and how many more, and never the value', async () => {
    const logs = capturedLogs();
    const { dispatcher, run } = harness();
    const logging = (input: unknown) =>
      run(
        dispatcher.dispatchToPlaybook(shelve.registration, toAlpha(acmeAdmin, input)).pipe(Effect.provide(logs.layer)),
      );
    const rows = Array.from({ length: 12 }, (_unused, size) => JSON.stringify({ size }));

    await logging({ tags: '["red"]', entry: { headers: '{"accept":"json"}' } });
    await logging({ rows });

    expect(logs.logged().map(({ annotations }) => annotations)).toEqual([
      { operation: 'shelve', argument: '/tags, /entry/headers' },
      {
        operation: 'shelve',
        argument: Array.from({ length: 10 }, (_unused, index) => `/rows/${index}`).join(', '),
        more_arguments: 2,
      },
    ]);
    expect(logs.text()).not.toContain('red');
  });
});

describe('an argument given as JSON text, where the value it holds is not taken', () => {
  it('never alters what a caller sent as text for an argument declared as text, even where the text holds text the schema takes', async () => {
    expect(await shelving({ code: JSON.stringify('red') })).toEqual(refusedAt('/code'));
  });

  it('is refused as given where a check refused the text and not the type of its place, whatever the value it holds: a size limit, a check of any JSON value, or the check of the text member of a union', async () => {
    expect([
      await shelving({ bounded: JSON.stringify({ a: 'bcdef' }) }),
      await shelving({ extras: { tenant: '[1, 2]' } }),
      await shelving({ choice: '["a"]' }),
    ]).toEqual([refusedAt('/bounded'), refusedAt('/extras/tenant'), refusedAt('/choice')]);
  });

  it('is refused as given where its text is not JSON, holds a value the input schema refuses, holds text that holds JSON, or sits beside another argument the schema refuses', async () => {
    expect([
      await shelving({ tags: 'red, blue' }),
      await shelving({ tags: '[1]' }),
      await shelving({ entry: JSON.stringify(JSON.stringify({ headers: {} })) }),
      await shelving({ tags: '["red"]', count: 'many' }),
    ]).toEqual([refusedAt('/tags'), refusedAt('/tags'), refusedAt('/entry'), refusedAt('/count', '/tags')]);
  });

  it('is refused as given where its text holds a number, a boolean or null, which only an object or an array is taken from', async () => {
    expect([await shelving({ count: '3' }), await shelving({ either: 'null' })]).toEqual([
      refusedAt('/count'),
      refusedAt('/either'),
    ]);
  });

  it('is refused as given, without failing the call, where the value its text holds is nested too deeply to decode', async () => {
    const { dispatcher, reported, run } = harness();
    const deepText = JSON.stringify(treeNested(5_000));

    expect(
      await run(dispatcher.dispatchToPlaybook(holdTree.registration, toAlpha(acmeAdmin, { tree: deepText }))),
    ).toEqual(refusedAt('/tree'));
    expect(reported()).toEqual([]);
  });

  it('is not read in an input given as strings, where every value arrives as text', async () => {
    expect(await shelving({ tags: '["red"]' }, 'strings')).toEqual(refusedAt('/tags'));
  });
});
