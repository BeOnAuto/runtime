import { InvalidInput, textToKeep } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability } from '../capability/capability.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { nothingSaved } from '../testing/nothing-saved.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const toBeta = toPlaybook('acme', 'beta');

const answering = defineCapability({
  type: 'answering',
  title: 'Answering',
  guide: { name: 'answering' },
  noun: { one: 'answer', other: 'answers' },
  describeOutput: () => 'It answered.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed({ source }),
  summarize: ({ source }) =>
    source === 'bare'
      ? {}
      : { inputSchema: { type: 'object', title: source }, outputSchema: { type: 'string', title: source } },
  run: () => Effect.succeed({ output: null, record: {} }),
});

const leaning = defineCapability({
  type: 'leaning',
  title: 'Leaning',
  guide: { name: 'leaning' },
  noun: { one: 'leaner', other: 'leaners' },
  describeOutput: () => 'It leaned.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed({ on: source }),
  check: ({ on }, _source, saved) =>
    Effect.flatMap(saved.active('answering', on), (found) =>
      found === undefined
        ? Effect.fail(new InvalidInput({ detail: `No answer ${on}`, issues: [{ pointer: '', detail: on }] }))
        : Effect.succeed({ module: JSON.stringify(found) }),
    ),
  summarize: () => ({}),
  run: (_parsed, _input, _run, { module = '' }) => Effect.succeed({ output: module, record: {} }),
});

const keeping = defineCapability({
  type: 'keeping',
  title: 'Keeping',
  guide: { name: 'keeping' },
  noun: { one: 'keeper', other: 'keepers' },
  describeOutput: () => 'It kept.',
  mediaType: 'text/plain',
  parse: (source: string) => Effect.succeed({ sha256: source }),
  check: ({ sha256 }, _source, saved) =>
    Effect.flatMap(saved.content(sha256), (kept) =>
      kept === undefined
        ? Effect.fail(
            new InvalidInput({ detail: `Nothing kept under ${sha256}`, issues: [{ pointer: '', detail: sha256 }] }),
          )
        : Effect.succeed({}),
    ),
  summarize: () => ({}),
  run: () => Effect.succeed({ output: null, record: {} }),
});

function saving() {
  const operations = definitionOperationsFor([answering, leaning, keeping]);
  const { call, ledger } = harness();
  const save = (to: typeof toAlpha, type: string, name: string, source: string) =>
    call(operations.createDefinition, to(acmeAdmin, { type, name, source }));
  const leaned = (to: typeof toAlpha, name: string) =>
    call(operations.runDefinition, to(acmeAdmin, { type: 'leaning', name, input: {} }));
  return { call, operations, save, leaned, ledger };
}

describe('the definitions a check reads outside a save', () => {
  it('are none when the check is given nothing saved, which keeps no content either', async () => {
    const refused = await Effect.runPromise(Effect.flip(Effect.runSync(leaning.prepare('ask')).check(nothingSaved)));

    expect(refused).toMatchObject({ detail: 'No answer ask' });
    expect(await Effect.runPromise(nothingSaved.content('a'.repeat(64)))).toBeUndefined();
  });
});

describe('the definitions a check reads when a document is saved', () => {
  it('are the active definitions of the playbook it is saved in, with their version and schemas', async () => {
    const { save, leaned } = saving();
    await save(toAlpha, 'answering', 'ask', 'first');
    await save(toAlpha, 'answering', 'bare-ask', 'bare');

    expect(await save(toAlpha, 'leaning', 'on-ask', 'ask')).toMatchObject({ status: 'succeeded' });
    expect(await save(toAlpha, 'leaning', 'on-bare', 'bare-ask')).toMatchObject({ status: 'succeeded' });
    expect(await leaned(toAlpha, 'on-ask')).toMatchObject({
      output: {
        output: JSON.stringify({
          name: 'ask',
          version: 1,
          inputSchema: { type: 'object', title: 'first' },
          outputSchema: { type: 'string', title: 'first' },
        }),
      },
    });
    expect(await leaned(toAlpha, 'on-bare')).toMatchObject({
      output: { output: JSON.stringify({ name: 'bare-ask', version: 1 }) },
    });
  });

  it('leave out a retired definition, one of another playbook and one that was never saved', async () => {
    const { call, operations, save } = saving();
    await save(toAlpha, 'answering', 'ask', 'first');
    await save(toAlpha, 'answering', 'gone', 'first');
    await call(operations.retireDefinition, toAlpha(acmeAdmin, { type: 'answering', name: 'gone' }));
    const refused = { status: 'rejected', reason: 'invalid_input' };

    expect(await save(toAlpha, 'leaning', 'on-gone', 'gone')).toMatchObject(refused);
    expect(await save(toBeta, 'leaning', 'on-ask', 'ask')).toMatchObject(refused);
    expect(await save(toAlpha, 'leaning', 'on-nothing', 'never')).toMatchObject(refused);
  });
});

describe('the content a check reads when a document is saved', () => {
  it('is what the playbook it is saved in keeps, and nothing another playbook keeps', async () => {
    const { save, ledger } = saving();
    const { sha256 } = await Effect.runPromise(
      ledger.service.content.put({ org: 'acme', playbook: 'alpha' }, textToKeep('kept rows', 'text/csv')),
    );

    expect(await save(toAlpha, 'keeping', 'rows', sha256)).toMatchObject({ status: 'succeeded' });
    expect(await save(toBeta, 'keeping', 'rows', sha256)).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
    });
  });
});
