import { NotFound, type Context, type DefinitionContext } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { earlierDefinitionIdOf } from '../identity/definition-ids.ts';
import { recordedAdmin } from '../testing/callers.ts';
import type { DefinitionCommand } from './definition-commands.ts';
import type { DefinitionContent, RecordedDefinitionEvent } from './definition-events.ts';
import { definitionsDecider } from './definitions-decider.ts';

const echoDefinitions = definitionsDecider('echo', { org: 'acme', playbook: 'alpha' });

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

function decided(...history: readonly RecordedDefinitionEvent[]) {
  return echoDefinitions.decide(restoringGreet, registryAfter(echoDefinitions, ...history));
}

describe('restoring a retired definition', () => {
  it('records its restoration with the content of its latest version and who restored it, at that version', () => {
    const history = [created('greet', hello), greetUpdated, retired('greet', 2)];

    expect(decided(...history)).toStrictEqual(
      Result.succeed([{ type: 'definition_restored', data: { content: howdy, restored_by: recordedAdmin } }]),
    );
    expect(echoDefinitions.context(restoringGreet, registryAfter(echoDefinitions, ...history))).toStrictEqual({
      ...ofTheDefinition('greet', restoring, 2),
      definitionId: earlierDefinitionIdOf({ org: 'acme', playbook: 'alpha', type: 'echo', name: 'greet' }),
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
