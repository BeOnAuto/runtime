import { InvalidInput, Unavailable, type PlaybookAddress } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability } from '../capability/capability.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const unsaid = new InvalidInput({
  detail: 'The checked definition has a problem',
  issues: [{ pointer: '', detail: 'Line 1: say which word it greets with' }],
  options: {
    question: 'Which word should it greet with?',
    choices: [{ value: 'hello', title: 'Hello', issues: [{ pointer: '', detail: 'Line 1: write hello' }] }],
  },
});

function checkedCapability() {
  const checked: string[] = [];
  const places: PlaybookAddress[] = [];
  const capability = defineCapability({
    type: 'checked',
    title: 'Checked',
    guide: { name: 'checked' },
    noun: { one: 'check', other: 'checks' },
    describeOutput: () => 'It answered its document.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed({ text: source }),
    check: ({ text }, source, place) => {
      checked.push(source);
      places.push(place);
      if (text.includes('slow')) {
        return Effect.fail(new Unavailable({ detail: 'The check of the document did not answer in time' }));
      }
      if (text.includes('which')) {
        return Effect.fail(unsaid);
      }
      return text.includes('wrong')
        ? Effect.fail(
            new InvalidInput({
              detail: 'The checked definition has a problem',
              issues: [{ pointer: '', detail: 'Line 1: wrong is not a word this capability takes' }],
            }),
          )
        : Effect.succeed({ module: text.toUpperCase() });
    },
    summarize: ({ text }) => ({ description: text }),
    run: ({ text }, _input, _run, { module = text }) => Effect.succeed({ output: module, record: {} }),
  });
  return { capability, checked: () => checked, places: () => places };
}

function saving() {
  const { capability, checked, places } = checkedCapability();
  const operations = definitionOperationsFor([capability]);
  const { call } = harness();
  const create = (name: string, source: string) =>
    call(operations.createDefinition, toAlpha(acmeAdmin, { type: 'checked', name, source }));
  const update = (name: string, source: string) =>
    call(operations.updateDefinition, toAlpha(acmeAdmin, { type: 'checked', name, source }));
  return { call, operations, create, update, checked, places };
}

describe('the check of a document when it is saved', () => {
  it('refuses a document its check finds wrong, with the issues under the source, and saves nothing', async () => {
    const { create, update, checked } = saving();

    expect(await create('greet', 'wrong')).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The checked definition has a problem',
      issues: [{ pointer: '/source', detail: 'Line 1: wrong is not a word this capability takes' }],
    });
    expect(await create('greet', 'right')).toMatchObject({ status: 'succeeded', output: { version: 1 } });
    expect(await update('greet', 'still wrong')).toMatchObject({ status: 'rejected', reason: 'invalid_input' });
    expect(checked()).toEqual(['wrong', 'right', 'still wrong']);
  });

  it('is unavailable on both saves when the check does not answer in time', async () => {
    const { create, update } = saving();
    await create('greet', 'right');
    const unavailable = {
      status: 'rejected',
      reason: 'unavailable',
      detail: 'The check of the document did not answer in time',
    };

    expect(await create('wave', 'slow')).toEqual(unavailable);
    expect(await update('greet', 'slow')).toEqual(unavailable);
  });

  it('never runs when a definition is read or run, whose run takes what the check stripped at its save, which no read shows', async () => {
    const { call, operations, create, checked } = saving();
    await create('greet', 'right');

    const read = await call(operations.getDefinition, toAlpha(acmeAdmin, { type: 'checked', name: 'greet' }));
    expect(read).toMatchObject({ status: 'succeeded', output: { source: 'right' } });
    expect(JSON.stringify(read)).not.toContain('RIGHT');
    expect(
      await call(operations.runDefinition, toAlpha(acmeAdmin, { type: 'checked', name: 'greet', input: {} })),
    ).toMatchObject({ status: 'succeeded', output: { output: 'RIGHT' } });
    expect(checked()).toEqual(['right']);
  });
});

describe('the check of a document, given the playbook it is saved in', () => {
  it('is handed that playbook on a create and on an update', async () => {
    const { create, update, places } = saving();
    await create('greet', 'right');
    await update('greet', 'righter');

    expect(places()).toEqual([
      { org: 'acme', playbook: 'alpha' },
      { org: 'acme', playbook: 'alpha' },
    ]);
  });

  it('refuses with the options it offers, the issues of each choice under the source too', async () => {
    const { create } = saving();

    expect(await create('greet', 'which')).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The checked definition has a problem',
      issues: [{ pointer: '/source', detail: 'Line 1: say which word it greets with' }],
      options: {
        question: 'Which word should it greet with?',
        choices: [{ value: 'hello', title: 'Hello', issues: [{ pointer: '/source', detail: 'Line 1: write hello' }] }],
      },
    });
  });
});
