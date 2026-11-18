import { type Context, type DefinitionContext, NotFound } from '@on.auto/operations';
import { Effect, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { versionOf } from '../operations/registry-access.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { createdIn, executedIn } from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { recordedAdmin } from '../testing/callers.ts';
import type { DefinitionCommand } from './definition-commands.ts';
import type { DefinitionContent, RecordedDefinitionEvent } from './definition-events.ts';
import { definitionVersionFold, definitionVersionIn } from './definition-versions.ts';
import { definitionDecider } from './definitions-decider.ts';

function about(name: string, version: number, by = 'acme-admin'): DefinitionContext {
  return {
    by,
    at: '2026-10-01T09:00:00.000Z',
    definitionType: 'echo',
    definitionName: name,
    definitionVersion: version,
  };
}

const history: readonly RecordedDefinitionEvent[] = [
  {
    type: 'definition_created',
    data: { content: { source: 'one' }, created_by: recordedAdmin },
    context: about('greet', 1),
  },
  {
    type: 'definition_updated',
    data: { content: { source: 'two', stripped: { module: 'TWO' } } },
    context: about('greet', 2, 'person:ada'),
  },
  { type: 'definition_paused', data: { paused_by: recordedAdmin }, context: about('greet', 2) },
  { type: 'definition_resumed', data: {}, context: about('greet', 2) },
  { type: 'definition_retired', data: {}, context: about('greet', 2) },
];

const greetId = '019a5f00-0000-7000-8000-000000000002';

const echoDefinitions = definitionDecider('echo', { org: 'acme', playbook: 'alpha' }, greetId);

const creation = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const change = { by: 'acme-editor', at: '2026-10-02T10:30:00.000Z' };

const restoring = { by: 'acme-restorer', at: '2026-10-03T11:00:00.000Z' };

const hello: DefinitionContent = { source: '{"greeting": "Hello"}', overview: 'Greets everyone who arrives.' };

const howdy: DefinitionContent = { source: '{"greeting": "Howdy"}', overview: 'Greets with a howdy.' };

function ofTheDefinition(name: string, when: Pick<Context, 'by' | 'at'>, version: number): DefinitionContext {
  return { ...when, definitionType: 'echo', definitionName: name, definitionVersion: version };
}

function created(name: string, content: DefinitionContent): RecordedDefinitionEvent {
  const data = { content, created_by: recordedAdmin };
  return { type: 'definition_created', data, context: ofTheDefinition(name, creation, 1) };
}

function retired(name: string, version = 1): RecordedDefinitionEvent {
  return { type: 'definition_retired', data: {}, context: ofTheDefinition(name, change, version) };
}

const greetUpdated: RecordedDefinitionEvent = {
  type: 'definition_updated',
  data: { content: howdy },
  context: ofTheDefinition('greet', change, 2),
};

const greetRestored: RecordedDefinitionEvent = {
  type: 'definition_restored',
  data: { content: hello, restored_by: recordedAdmin },
  context: ofTheDefinition('greet', restoring, 1),
};

const restoringGreet: DefinitionCommand = { type: 'restore', name: 'greet', restored_by: recordedAdmin, ...restoring };

function registryAfter(decider: typeof echoDefinitions, ...events: readonly RecordedDefinitionEvent[]) {
  return events.reduce((registry, event) => decider.evolve(registry, event), decider.initialState);
}

function decided(...historyDefinitionRestorations: readonly RecordedDefinitionEvent[]) {
  return echoDefinitions.decide(restoringGreet, registryAfter(echoDefinitions, ...historyDefinitionRestorations));
}

describe('a search for one version of a definition, on its own stream', () => {
  it('finds its document and the position of the record that made it, as a fold that decides nothing', () => {
    const search = definitionVersionFold(2);
    const first = definitionVersionFold(1);

    expect(history.reduce((found, event) => search.evolve(found, event), search.initialState)).toEqual({
      position: 5,
      found: { source: { inline: 'two' }, stripped: { module: 'TWO' }, position: 2, putInPlaceBy: 'person:ada' },
    });
    expect(Object.keys(search).toSorted()).toEqual(['eventSchema', 'evolve', 'initialState']);
    expect(history.reduce((found, event) => first.evolve(found, event), first.initialState)).toEqual({
      position: 5,
      found: { source: { inline: 'one' }, position: 1, putInPlaceBy: 'acme-admin' },
    });
  });

  it('names who put the version in place: whoever saved it, or whoever restored it since', () => {
    const search = definitionVersionFold(2);
    const restored: RecordedDefinitionEvent = {
      type: 'definition_restored',
      data: { content: { source: 'two' }, restored_by: recordedAdmin },
      context: about('greet', 2, 'person:ben'),
    };
    const restoredBeforeAnySave: RecordedDefinitionEvent = { ...restored, context: about('greet', 3, 'person:ben') };
    const later = definitionVersionFold(3);

    expect([...history, restored].reduce((found, event) => search.evolve(found, event), search.initialState)).toEqual({
      position: 6,
      found: { source: { inline: 'two' }, stripped: { module: 'TWO' }, position: 2, putInPlaceBy: 'person:ben' },
    });
    expect(later.evolve(later.initialState, restoredBeforeAnySave)).toEqual({ position: 1, found: undefined });
  });
});

function refusal(name: string, version: number) {
  return versionOf('echo', name, version).pipe(
    Effect.as('found'),
    Effect.catchTag('not_found', ({ detail }: { readonly detail: string }) => Effect.succeed(detail)),
  );
}

describe('a read of one version of a definition of a playbook', () => {
  it('finds its document on the stream of the definition that holds the name in the playbook, and nothing for a version or a playbook that has none', async () => {
    const ledger = readModelLedgerOf(['echo']).service;
    await createdIn(ledger, 'greet');
    await executedIn(ledger, 'echo', { type: 'update', name: 'greet', content: { source: 'two' } });
    const alpha = { org: 'acme', playbook: 'alpha' };

    const found = await Effect.runPromise(
      Effect.all([
        definitionVersionIn(ledger, alpha, { type: 'echo', name: 'greet', version: 2 }),
        definitionVersionIn(ledger, alpha, { type: 'echo', name: 'greet', version: 3 }),
        definitionVersionIn(ledger, { org: 'acme', playbook: 'beta' }, { type: 'echo', name: 'greet', version: 1 }),
      ]),
    );

    expect(found).toEqual([
      { source: { inline: 'two' }, position: 2, putInPlaceBy: 'person_reader' },
      undefined,
      undefined,
    ]);
  });

  it('is refused for a name no definition of the playbook holds, and for a version its definition never saved', async () => {
    const ledger = readModelLedgerOf(['echo']);
    await createdIn(ledger.service, 'greet');
    expect(
      await inThePlaybook(ledger, Effect.all([refusal('nobody', 1), refusal('greet', 2), refusal('greet', 1)])),
    ).toEqual([
      'There is no version 1 of the echo definition nobody in this playbook',
      'There is no version 2 of the echo definition greet in this playbook',
      'found',
    ]);
  });
});

describe('restoring a retired definition', () => {
  it('records its restoration with the content of its latest version and who restored it, at that version', () => {
    const historyDefinitionRestorations = [created('greet', hello), greetUpdated, retired('greet', 2)];

    expect(decided(...historyDefinitionRestorations)).toStrictEqual(
      Result.succeed([{ type: 'definition_restored', data: { content: howdy, restored_by: recordedAdmin } }]),
    );
    expect(
      echoDefinitions.context(restoringGreet, registryAfter(echoDefinitions, ...historyDefinitionRestorations)),
    ).toStrictEqual({
      ...ofTheDefinition('greet', restoring, 2),
      definitionId: greetId,
    });
  });

  it('records nothing for a definition that is active, or restored already', () => {
    expect([
      decided(created('greet', hello)),
      decided(created('greet', hello), retired('greet'), greetRestored),
    ]).toEqual([Result.succeed([]), Result.succeed([])]);
  });

  it('is rejected for a definition the playbook does not have', () => {
    expect(decided()).toEqual(
      Result.fail(new NotFound({ detail: 'There is no echo definition greet in this playbook' })),
    );
  });
});
