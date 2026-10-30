import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, adaOfAcme } from '../testing/callers.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { probe } from '../testing/capabilities/probe.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { firstMoment, harness, toPlaybook } from '../testing/harness.ts';

const { createDefinition, retireDefinition, updateDefinition } = definitionOperationsFor([echo, probe().capability]);

const toAlpha = toPlaybook('acme', 'alpha');

const hello = '{"greeting": "Hello", "description": "Greets the caller"}';

const greetOverview = [
  'Greets each guest who arrives at the front desk, so nobody waits unnoticed.',
  '```mermaid\nflowchart LR\n  guest[A guest arrives] --> greet[Greet them]\n```',
].join('\n\n');

function creating(input: object) {
  return harness().call(createDefinition, toAlpha(acmeAdmin, input));
}

function creatingFrom(source: string) {
  return creating({ type: 'probe', name: 'plain', source });
}

function creatingWithOverview(overview: string) {
  return creating({ type: 'probe', name: 'plain', source: 'text', overview });
}

describe('create_definition', () => {
  it('is a playbook command at POST /definitions/{type} that answers 201', () => {
    expect(createDefinition.registration).toMatchObject({
      scope: 'playbook',
      kind: 'command',
      title: 'Create definition',
      route: { method: 'POST', path: '/definitions/{type}' },
      pathParameters: ['type'],
      successStatus: 201,
      reasons: ['not_found', 'invalid_input', 'conflict', 'unavailable'],
    });
  });

  it('creates an active definition at version 1 with what its capability says about it and the overview its author gave', async () => {
    expect(await creating({ type: 'echo', name: 'greet', source: hello, overview: greetOverview })).toStrictEqual({
      status: 'succeeded',
      output: {
        type: 'echo',
        name: 'greet',
        version: 1,
        status: 'active',
        media_type: 'application/json',
        description: 'Greets the caller',
        input_schema: { type: 'object' },
        output_schema: {
          type: 'object',
          properties: { greeting: { const: 'Hello' }, input: { type: 'object' } },
          required: ['greeting', 'input'],
        },
        created_at: firstMoment,
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: firstMoment,
        source: hello,
        overview: greetOverview,
      },
    });
  });
});

describe('who created a definition', () => {
  it('is the caller who created it, a person by their id and their name', async () => {
    const created = await harness().call(
      createDefinition,
      toAlpha(adaOfAcme, { type: 'probe', name: 'plain', source: 'text' }),
    );

    expect(created).toMatchObject({ output: { created_by: { id: 'person:user_2ada', name: 'Ada Lovelace' } } });
  });

  it('stays the caller who created it when another updates it', async () => {
    const definitions = harness();
    await definitions.call(createDefinition, toAlpha(adaOfAcme, { type: 'probe', name: 'plain', source: 'text' }));

    expect(
      await definitions.call(updateDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'more' })),
    ).toMatchObject({ output: { version: 2, created_by: { id: 'person:user_2ada', name: 'Ada Lovelace' } } });
  });
});

describe('the warnings of a definition', () => {
  it('are what its capability found in the document, shown with the definition', async () => {
    const source = '{"greeting": "Hello", "warnings": ["Line 2: greeting may be too warm for some readers"]}';

    expect(await creating({ type: 'echo', name: 'greet', source })).toMatchObject({
      output: { warnings: ['Line 2: greeting may be too warm for some readers'] },
    });
  });

  it('are left out when the capability found none', async () => {
    const created = await creating({ type: 'echo', name: 'greet', source: '{"greeting": "Hi", "warnings": []}' });

    expect(created).toMatchObject({ status: 'succeeded' });
    expect(created).not.toHaveProperty('output.warnings');
  });
});

describe('the definition create_definition records', () => {
  it('leaves out what the capability does not say about a definition, and an overview its author did not give', async () => {
    expect(await creating({ type: 'probe', name: 'plain', source: 'just text' })).toStrictEqual({
      status: 'succeeded',
      output: {
        type: 'probe',
        name: 'plain',
        version: 1,
        status: 'active',
        media_type: 'text/plain',
        created_at: firstMoment,
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: firstMoment,
        source: 'just text',
      },
    });
  });

  it('records the definitions of each capability in a stream of the playbook named after the capability', async () => {
    const { call, ledger } = harness();

    await call(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: hello }));
    await call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'text' }));

    expect(ledger.streamNames()).toEqual([
      'playbook/acme/alpha/definitions/echo',
      'playbook/acme/alpha/definitions/probe',
    ]);
  });
});

describe('create_definition rejecting a document', () => {
  it('that its capability cannot parse, with the issues under /source, and stores nothing', async () => {
    const { call, ledger } = harness();

    expect(
      await call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'plain', source: 'fine\noops\noops' })),
    ).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The probe document has lines it does not accept',
      issues: [
        { detail: 'Line 2 is not accepted', pointer: '/source' },
        { detail: 'Line 3 is not accepted', pointer: '/source' },
      ],
    });
    expect(ledger.streamNames()).toEqual([]);
  });

  it('of more than 65536 bytes in UTF-8, whatever its length in characters', async () => {
    const tooLong = {
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ detail: 'Expected a document of at most 65536 bytes in UTF-8', pointer: '/source' }],
    };

    expect(await creatingFrom('a'.repeat(65_536))).toMatchObject({ status: 'succeeded' });
    expect(await creatingFrom('é'.repeat(32_768))).toMatchObject({ status: 'succeeded' });
    expect(await creatingFrom('a'.repeat(65_537))).toEqual(tooLong);
    expect(await creatingFrom('é'.repeat(32_769))).toEqual(tooLong);
  });
});

describe('the overview create_definition takes', () => {
  it('is Markdown of at least one character and at most 16384 bytes in UTF-8, whatever its length in characters', async () => {
    const tooLong = {
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ detail: 'Expected an overview of at most 16384 bytes in UTF-8', pointer: '/overview' }],
    };

    expect(await creatingWithOverview('a'.repeat(16_384))).toMatchObject({ status: 'succeeded' });
    expect(await creatingWithOverview('é'.repeat(8192))).toMatchObject({ status: 'succeeded' });
    expect(await creatingWithOverview('a'.repeat(16_385))).toEqual(tooLong);
    expect(await creatingWithOverview('é'.repeat(8193))).toEqual(tooLong);
    expect(await creatingWithOverview('')).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/overview' }],
    });
  });
});

describe('the input of create_definition', () => {
  it('rejects a malformed name and a field the operation does not know', async () => {
    expect(await creating({ type: 'echo', name: 'Greet', source: hello, colour: 'red' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/colour' }, { pointer: '/name' }],
    });
    expect(await creating({ type: 'echo', name: 'go', source: hello })).toMatchObject({
      issues: [{ pointer: '/name' }],
    });
  });

  it('rejects a type that is malformed, and one this server does not run', async () => {
    expect(await creating({ type: 'Echo!', name: 'greet', source: hello })).toMatchObject({
      reason: 'invalid_input',
      issues: [
        {
          pointer: '/type',
          detail: 'Expected a type: 3 to 32 lowercase letters, digits and hyphens, starting with a letter',
        },
      ],
    });
    expect(await creating({ type: 'reasoning', name: 'greet', source: hello })).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [{ pointer: '/type', detail: 'Expected a type this server runs: echo or probe' }],
    });
  });
});

describe('create_definition rejecting with conflict', () => {
  it('a name an active or a retired definition of the capability holds', async () => {
    const { call } = harness();
    const creatingGreet = () =>
      call(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet', source: hello }));
    await creatingGreet();

    expect(await creatingGreet()).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The playbook already has the echo definition greet',
      kind: 'taken',
    });
    await call(retireDefinition, toAlpha(acmeAdmin, { type: 'echo', name: 'greet' }));
    expect(await creatingGreet()).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The echo definition greet was retired, and a definition name is never reused',
      kind: 'taken',
    });
    expect(
      await call(createDefinition, toAlpha(acmeAdmin, { type: 'probe', name: 'greet', source: 'text' })),
    ).toMatchObject({ status: 'succeeded' });
  });

  it('when another change to the definitions of the capability landed at the same moment', async () => {
    const { dispatch, run } = harness();
    const creatingDefinition = (name: string) =>
      dispatch(createDefinition, toAlpha(acmeAdmin, { type: 'echo', name, source: hello }));

    expect(
      await run(Effect.all([creatingDefinition('greet'), creatingDefinition('wave')], { concurrency: 'unbounded' })),
    ).toMatchObject([
      { status: 'succeeded', output: { name: 'greet' } },
      { status: 'rejected', reason: 'conflict' },
    ]);
  });
});
