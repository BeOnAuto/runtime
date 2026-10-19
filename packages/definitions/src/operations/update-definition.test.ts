import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, acmeAlphaKeeper } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const { createDefinition, getDefinition, retireDefinition, updateDefinition } = definitionOperationsFor([
  echo,
  probe().capability,
]);

const toAlpha = toPlaybook('acme', 'alpha');

const later = '2026-10-02T14:15:00.000Z';

const hello = '{"greeting": "Hello", "description": "Greets the caller"}';

async function withGreet() {
  const definitions = harness();
  await definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: hello }));
  return definitions;
}

const howdyOverview = [
  '# greet',
  'This greeting has no description yet.',
  '## What it needs',
  'A record.',
  '## What it produces',
  '| Field | Required | What it is |\n| --- | --- | --- |\n| **greeting** | yes | Exactly Howdy. |\n| **input** | yes | A record. |\n',
].join('\n\n');

function updatingGreet(source: string) {
  return toAlpha(acmeAlphaKeeper, { type: 'echo', name: 'greet', source });
}

describe('update_definition', () => {
  it('is a playbook command at PUT /definitions/{type}/{name}', () => {
    expect(updateDefinition.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      title: 'Update definition',
      route: { method: 'PUT', path: '/definitions/{type}/{name}' },
      pathParameters: ['type', 'name'],
      successStatus: 200,
      reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
    });
  });

  it('replaces the document and what the capability says about it, at a new version', async () => {
    const { call } = await withGreet();

    expect(await call(updateDefinition, updatingGreet('{"greeting": "Howdy"}'), later)).toStrictEqual({
      status: 'succeeded',
      output: {
        type: 'echo',
        name: 'greet',
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
        created_by: 'acme-admin',
        updated_at: later,
        source: '{"greeting": "Howdy"}',
        overview: howdyOverview,
      },
    });
    expect(await call(updateDefinition, updatingGreet(hello), later)).toMatchObject({
      output: { version: 3, description: 'Greets the caller' },
    });
  });
});

describe('update_definition of the same document', () => {
  it('succeeds and records nothing', async () => {
    const { call } = await withGreet();

    expect(await call(updateDefinition, updatingGreet(hello), later)).toMatchObject({
      status: 'succeeded',
      output: { version: 1, updated_at: firstMoment },
    });
  });
});

describe('update_definition rejecting', () => {
  it('a document its capability cannot parse, keeping the definition as it was', async () => {
    const { call } = await withGreet();

    expect(await call(updateDefinition, updatingGreet('{"greeting": 7}'))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The echo document is not a JSON object with a string greeting',
      issues: [{ detail: 'Expected string\n  at ["greeting"]', pointer: '/source' }],
    });
    expect(await call(getDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }))).toMatchObject({
      output: { version: 1, source: hello },
    });
  });

  it('a definition the playbook does not have, a retired definition and a type the server does not run', async () => {
    const { call } = await withGreet();
    await call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));

    expect(await call(updateDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'wave', source: hello }))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no echo definition wave in this playbook',
    });
    expect(await call(updateDefinition, updatingGreet('{"greeting": "Howdy"}'))).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The echo definition greet is retired and can no longer change',
      kind: 'retired',
    });
    expect(await call(updateDefinition, toAlpha(acmeAdmin, { type: 'reason', name: 'greet', source: hello }))).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/type', detail: 'Expected a type this server runs: echo or probe' }],
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
