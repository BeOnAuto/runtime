import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, acmeAlphaKeeper } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const someWords: unknown = expect.any(String);

const anId: unknown = expect.any(String);

const { createDefinition, getDefinition, retireDefinition, updateDefinition } = definitionOperationsFor([
  echo,
  probe().capability,
]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const hello = '{"greeting": "Hello", "description": "Greets the caller"}';

const greetOverview = 'Greets each guest who arrives at the front desk.';

async function withGreet() {
  const definitions = harness();
  await definitions.call(
    createDefinition,
    toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: hello, overview: greetOverview }),
  );
  return definitions;
}

function updatingGreet(source: string, overview?: string) {
  return toAlpha(acmeAlphaKeeper, {
    type: 'echo',
    name: 'greet',
    source,
    ...(overview === undefined ? {} : { overview }),
  });
}

describe('update_definition', () => {
  it('replaces the document and what the capability says about it, at a new version that keeps the saved overview when the update leaves it out', async () => {
    const { call } = await withGreet();

    expect(await call(updateDefinition, updatingGreet('{"greeting": "Howdy"}'), later)).toStrictEqual({
      status: 'succeeded',
      output: {
        type: 'echo',
        name: 'greet',
        definition_id: anId,
        version: 2,
        status: 'active',
        media_type: 'application/json',
        input_schema: { type: 'object' },
        output_schema: {
          type: 'object',
          properties: { greeting: { const: 'Howdy' }, input: { type: 'object' } },
          required: ['greeting', 'input'],
        },
        created_at: firstMoment,
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: later,
        source: '{"greeting": "Howdy"}',
        overview: greetOverview,
      },
    });
    expect(await call(updateDefinition, updatingGreet(hello, 'Greets each guest by name.'), later)).toMatchObject({
      output: { version: 3, description: 'Greets the caller', overview: 'Greets each guest by name.' },
    });
  });
});

describe('update_definition rejecting', () => {
  it('a document its capability cannot parse, keeping the definition as it was', async () => {
    const { call } = await withGreet();

    expect(await call(updateDefinition, updatingGreet('{"greeting": 7}'))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: someWords,
      issues: [{ detail: 'Expected string\n  at ["greeting"]', pointer: '/source' }],
    });
    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }))).toMatchObject({
      output: { version: 1, source: hello },
    });
  });

  it('a retired definition as a conflict, and a type the server does not run as invalid input', async () => {
    const { call } = await withGreet();
    await call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));

    expect(await call(updateDefinition, updatingGreet('{"greeting": "Howdy"}'))).toMatchObject({
      status: 'rejected',
      reason: 'conflict',
      kind: 'retired',
    });
    expect(
      await call(updateDefinition, toAlpha(acmeAdmin, { type: 'reason', name: 'greet', source: hello })),
    ).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/type' }],
    });
  });

  it('with conflict when another change to the definitions of the capability landed at the same moment', async () => {
    const { call, dispatch, run } = await withGreet();
    await call(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'wave', source: hello }));
    const updating = (name: string) =>
      dispatch(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name, source: '{"greeting": "Yo"}' }));

    expect(await run(Effect.all([updating('greet'), updating('wave')], { concurrency: 'unbounded' }))).toMatchObject([
      { status: 'succeeded', output: { name: 'greet', version: 2 } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
