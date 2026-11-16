import { beforeGoingOnOf, type Notice } from '@on.auto/operations';
import { mostNoticeCharacters } from '@on.auto/phrasing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { firstDefinitionNotice } from './definition-views.ts';

const toAlpha = toPlaybook('acme', 'alpha');
const toBeta = toPlaybook('acme', 'beta');

const noticeOf = (kind: string): Notice => ({ kind, detail: `The document says ${kind}.`, certainty: 'likely' });

function capabilityOf(type: string): Capability {
  return defineCapability({
    type,
    title: type,
    guide: { name: type },
    noun: { one: `${type} definition`, other: `${type} definitions` },
    describeOutput: () => 'It answered its document.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed({ text: source }),
    notices: ({ text }) =>
      Effect.succeed(
        text
          .split(' ')
          .filter((word) => word.startsWith('odd'))
          .map((word) => noticeOf(word)),
      ),
    summarize: ({ text }) => ({ description: text }),
    run: ({ text }) => Effect.succeed({ output: text, record: {} }),
  });
}

function saving(types: readonly string[]) {
  const operations = definitionOperationsFor(types.map((type) => capabilityOf(type)));
  const { call } = harness();
  const create = (type: string, name: string, source = 'plain', to = toAlpha) =>
    call(operations.createDefinition, to(acmeAdmin, { type, name, source }));
  const update = (type: string, name: string, source: string) =>
    call(operations.updateDefinition, toAlpha(acmeAdmin, { type, name, source }));
  return { create, update };
}

describe('the reminder that answers the first definition saved in a playbook', () => {
  it("asks whether the person saw the workflow's steps with their types and said yes to the design, as a reminder within the bound of a notice", () => {
    expect(firstDefinitionNotice).toEqual({
      kind: 'first_definition',
      detail:
        "This is the playbook's first function or workflow. Has the person seen the workflow's steps in order, each with its function type, and said yes to that design? If not, show them the design now, in their words, and wait for their yes before you save anything else; if they change it, change what you just saved to match.",
      certainty: 'reminder',
    });
    expect(firstDefinitionNotice.detail.length).toBeLessThanOrEqual(mostNoticeCharacters);
  });

  it('answers the save of a function or of a workflow into a playbook that holds neither, once in each playbook', async () => {
    const { create } = saving(['noticed', 'workflow']);

    expect(await create('noticed', 'greet')).toMatchObject({
      status: 'succeeded',
      output: { version: 1, notices: [firstDefinitionNotice], before_going_on: beforeGoingOnOf(1) },
    });
    expect(await create('workflow', 'welcome', 'plain', toBeta)).toMatchObject({
      status: 'succeeded',
      output: { version: 1, notices: [firstDefinitionNotice], before_going_on: beforeGoingOnOf(1) },
    });
  });
});

describe('the reminder of a first definition among other notices, and on later saves', () => {
  it('comes after the notices of the document, three at most', async () => {
    const { create } = saving(['noticed', 'workflow']);

    expect(await create('noticed', 'greet', 'odd-one')).toMatchObject({
      output: { notices: [noticeOf('odd-one'), firstDefinitionNotice], before_going_on: beforeGoingOnOf(2) },
    });
    expect(await create('noticed', 'many', 'odd-a odd-b odd-c', toBeta)).toMatchObject({
      output: { notices: ['odd-a', 'odd-b', 'odd-c'].map((kind) => noticeOf(kind)) },
    });
  });

  it('answers no later save: another definition of the same type or of another, or a second version', async () => {
    const { create, update } = saving(['noticed', 'workflow']);
    await create('noticed', 'greet');

    const later = [
      await create('noticed', 'farewell'),
      await create('workflow', 'welcome'),
      await update('noticed', 'greet', 'plainer'),
    ];

    expect(later).toMatchObject([
      { status: 'succeeded', output: { version: 1 } },
      { status: 'succeeded', output: { version: 1 } },
      { status: 'succeeded', output: { version: 2 } },
    ]);
    expect(JSON.stringify(later)).not.toContain('notices');
  });

  it('answers no save on a server that runs no workflow', async () => {
    const { create } = saving(['noticed']);

    expect(JSON.stringify(await create('noticed', 'greet'))).not.toContain('notices');
  });
});
