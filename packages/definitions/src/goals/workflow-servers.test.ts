import { PlaybookContext, playbookLedgerOf } from '@on.auto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability } from '../capability/capability.ts';
import { splitDocument } from '../document/document-split.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toPlaybook, type Harness } from '../testing/harness.ts';
import { mostCallDepth, serversOfTheSource, workflowServersIn } from './workflow-servers.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const Calls = Schema.Array(Schema.Struct({ type: Schema.String, name: Schema.String }));

const decodedWorkflow = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ calls: Calls, tools: Schema.optionalKey(Schema.Array(Schema.String)) })),
);

function detailsOf(calls: typeof Calls.Type) {
  return { details: { calls: calls.map((called) => ({ ...called, steps: [{ number: 1, name: 'step' }] })) } };
}

const calling: Capability = defineCapability({
  type: 'workflow',
  title: 'Workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It ran.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodedWorkflow(source)),
  summarize: ({ calls }) => detailsOf(calls),
  run: () => Effect.succeed({ output: {}, record: {} }),
});

const decodedBody = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ calls: Calls })));

function functionOf(type: string): Capability {
  return defineCapability({
    type,
    title: type,
    guide: { name: type },
    noun: { one: type, other: type },
    describeOutput: () => 'It ran.',
    mediaType: 'text/markdown',
    parse: (source: string) =>
      Effect.orDie(decodedBody(Result.getOrThrow(splitDocument(source, 'The definition')).body)),
    summarize: ({ calls }) => detailsOf(calls),
    run: () => Effect.succeed({ output: {}, record: {} }),
  });
}

const operations = definitionOperationsFor([calling, functionOf('lookup'), functionOf('interaction')]);

function saved(definitions: Harness, type: string, name: string, source: string) {
  const diagram = type === 'workflow' ? {} : { diagram: 'none' };
  return definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { type, name, source, ...diagram }));
}

function withFrontMatter(front: string, calls: readonly object[] = []): string {
  return `---\n${front}\n---\n${JSON.stringify({ calls })}`;
}

function serversOf(definitions: Harness, workflows: readonly string[]) {
  return Effect.runPromise(
    workflowServersIn(workflows).pipe(
      Effect.provideService(PlaybookContext, { org: 'acme', playbook: 'alpha' }),
      Effect.provide(playbookLedgerOf(definitions.ledger.service, { org: 'acme', playbook: 'alpha' })),
    ),
  );
}

async function playbookThatApprovesAndSends() {
  const definitions = harness();
  await saved(definitions, 'lookup', 'project-shot', withFrontMatter('call:\n  server: google-drive\n  tool: list'));
  await saved(definitions, 'lookup', 'old-shot', withFrontMatter('call:\n  server: old-drive\n  tool: list'));
  await definitions.call(operations.retireDefinition, toAlpha(acmeAdmin, { type: 'lookup', name: 'old-shot' }));
  await saved(
    definitions,
    'interaction',
    'ask-the-producer',
    withFrontMatter('deliver:\n  server: auto-for-slack\n  tool: post', [{ type: 'lookup', name: 'project-shot' }]),
  );
  const calls = [
    { type: 'interaction', name: 'ask-the-producer' },
    { type: 'lookup', name: 'project-shot' },
    { type: 'lookup', name: 'old-shot' },
    { type: 'lookup', name: 'no-such-lookup' },
  ];
  await saved(definitions, 'workflow', 'approve-and-send', JSON.stringify({ calls, tools: ['gmail/send'] }));
  await saved(definitions, 'workflow', 'find-requests', JSON.stringify({ calls: [] }));
  return definitions;
}

describe('the servers a workflow uses', () => {
  it('are those it and every function it calls name, through functions they call, each once and in order', async () => {
    const definitions = await playbookThatApprovesAndSends();

    expect(await serversOf(definitions, ['approve-and-send', 'find-requests', 'not-saved'])).toEqual(
      new Map([
        ['approve-and-send', ['auto-for-slack', 'gmail', 'google-drive']],
        ['find-requests', []],
        ['not-saved', []],
      ]),
    );
  });
});

describe('the servers a workflow uses, far down its calls', () => {
  it(`follow calls at most ${mostCallDepth} deep`, async () => {
    const definitions = harness();
    const names = Array.from({ length: mostCallDepth + 1 }, (_, index) => `step-${index + 1}`);
    const lookupOf = (name: string, calls: readonly object[]) =>
      saved(definitions, 'lookup', name, withFrontMatter(`call:\n  server: server-${name}\n  tool: read`, calls));
    await names
      .slice(0, -1)
      .toReversed()
      .reduce(
        (before: Readonly<Promise<unknown>>, name, index) =>
          before.then(() => lookupOf(name, [{ type: 'lookup', name: String(names.at(-1 - index)) }])),
        lookupOf(String(names.at(-1)), []),
      );
    await saved(definitions, 'workflow', 'deep', JSON.stringify({ calls: [{ type: 'lookup', name: 'step-1' }] }));

    expect(await serversOf(definitions, ['deep'])).toEqual(
      new Map([['deep', names.slice(0, mostCallDepth).map((name) => `server-${name}`)]]),
    );
  });
});

describe('the servers of a document the store cannot give', () => {
  it('are none, and those it names once it is read', () => {
    expect([
      serversOfTheSource('lookup', { unread: { because: 'unavailable', bytes: 2048 } }),
      serversOfTheSource('lookup', { text: withFrontMatter('call:\n  server: crm\n  tool: read') }),
    ]).toEqual([[], ['crm']]);
  });
});
