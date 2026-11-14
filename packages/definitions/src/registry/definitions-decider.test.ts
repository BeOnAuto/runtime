import { Conflict, NotFound, type Context, type DefinitionContext } from '@on.auto/operations';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { earlierDefinitionIdOf } from '../identity/definition-ids.ts';
import { recordedAdmin } from '../testing/callers.ts';
import type { DefinitionCommand } from './definition-commands.ts';
import type { DefinitionContent, RecordedDefinitionEvent } from './definition-events.ts';
import { definitionsDecider, definitionTypeStreamOf } from './definitions-decider.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const echoDefinitions = definitionsDecider('echo', alpha);

const greetId = earlierDefinitionIdOf({ ...alpha, type: 'echo', name: 'greet' });

function identified(context: Context): Context {
  return { ...context, definitionId: greetId };
}

const creation = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const change = { by: 'acme-editor', at: '2026-10-02T10:30:00.000Z' };

const hello: DefinitionContent = {
  source: '{"greeting": "Hello"}',
  overview: 'Greets everyone who arrives at the front desk.',
  description: 'Greets',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
};

const howdy: DefinitionContent = { source: '{"greeting": "Howdy"}', overview: 'Greets with a howdy.' };

type RecordedDefinition = RecordedDefinitionEvent;

function ofTheDefinition(name: string, when: Pick<Context, 'by' | 'at'>, version: number): DefinitionContext {
  return { ...when, definitionType: 'echo', definitionName: name, definitionVersion: version };
}

function created(name: string, content: DefinitionContent): RecordedDefinition {
  const data = { content, created_by: recordedAdmin };
  return { type: 'definition_created', data, context: ofTheDefinition(name, creation, 1) };
}

const greetCreated = created('greet', hello);

const greetUpdated: RecordedDefinition = {
  type: 'definition_updated',
  data: { content: howdy },
  context: ofTheDefinition('greet', change, 2),
};

function retired(name: string, at = change.at, version = 1): RecordedDefinition {
  return { type: 'definition_retired', data: {}, context: ofTheDefinition(name, { ...change, at }, version) };
}

const greetRetired = retired('greet');

function registryAfter(...events: readonly RecordedDefinition[]) {
  return events.reduce((registry, event) => echoDefinitions.evolve(registry, event), echoDefinitions.initialState);
}

function decided(command: DefinitionCommand, ...history: readonly RecordedDefinition[]) {
  return echoDefinitions.decide(command, registryAfter(...history));
}

function contextOf(command: DefinitionCommand, ...history: readonly RecordedDefinition[]) {
  return echoDefinitions.context(command, registryAfter(...history));
}

const asTheAdmin = { ...creation, created_by: recordedAdmin };

const creatingGreet: DefinitionCommand = {
  type: 'create',
  name: 'greet',
  content: hello,
  definition_id: greetId,
  ...asTheAdmin,
};

function updatingGreet(content: DefinitionContent): DefinitionCommand {
  return { type: 'update', name: 'greet', content, ...change };
}

const retiringGreet: DefinitionCommand = { type: 'retire', name: 'greet', ...change };

describe('creating a definition', () => {
  it('records its content, the id it is given and its playbook, with the definition at version 1, who created it and when as its context', () => {
    expect(decided(creatingGreet)).toStrictEqual(
      Result.succeed([
        {
          type: 'definition_created',
          data: { content: hello, created_by: recordedAdmin, definition_id: greetId, playbook: 'alpha' },
        },
      ]),
    );
    expect(contextOf(creatingGreet)).toStrictEqual(identified(greetCreated.context));
  });

  it('leaves to the names of definitions whether its name is free', () => {
    expect(decided(creatingGreet, greetCreated)).toStrictEqual(decided(creatingGreet));
  });
});

describe('updating a definition', () => {
  it('records a new version, one more than the last, as its context', () => {
    expect(decided(updatingGreet(howdy), greetCreated)).toStrictEqual(
      Result.succeed([{ type: 'definition_updated', data: { content: howdy } }]),
    );
    expect([
      contextOf(updatingGreet(howdy), greetCreated),
      contextOf(updatingGreet(hello), greetCreated, greetUpdated),
      contextOf(updatingGreet(hello)),
    ]).toStrictEqual([
      identified(greetUpdated.context),
      identified(ofTheDefinition('greet', change, 3)),
      identified({ ...change, definitionType: 'echo', definitionName: 'greet' }),
    ]);
  });

  it('records nothing when the document is the same, with its overview the same or left out', () => {
    const { overview: _overview, ...leftOut } = hello;

    expect([decided(updatingGreet(hello), greetCreated), decided(updatingGreet(leftOut), greetCreated)]).toStrictEqual([
      Result.succeed([]),
      Result.succeed([]),
    ]);
  });

  it('is rejected for a definition the playbook does not have', () => {
    expect(decided(updatingGreet(howdy))).toEqual(
      Result.fail(new NotFound({ detail: 'There is no echo definition greet in this playbook' })),
    );
  });

  it('is rejected for a retired definition', () => {
    expect(decided(updatingGreet(howdy), greetCreated, greetRetired)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The echo definition greet is retired; restore it to change it', kind: 'retired' }),
      ),
    );
  });
});

describe('updating the overview of a definition', () => {
  it('records a new version when the overview alone changes', () => {
    const rewritten = { ...hello, overview: 'Greets each guest by name.' };

    expect(decided(updatingGreet(rewritten), greetCreated)).toStrictEqual(
      Result.succeed([{ type: 'definition_updated', data: { content: rewritten } }]),
    );
  });

  it('keeps the saved overview when the update leaves it out, and none when none was saved', () => {
    const { overview: _overview, ...unwritten } = howdy;

    expect([
      decided(updatingGreet(unwritten), greetCreated),
      decided(updatingGreet(unwritten), created('greet', { source: hello.source })),
    ]).toStrictEqual([
      Result.succeed([{ type: 'definition_updated', data: { content: { ...unwritten, overview: hello.overview } } }]),
      Result.succeed([{ type: 'definition_updated', data: { content: unwritten } }]),
    ]);
  });
});

describe('retiring a definition', () => {
  it('records the retirement of an active definition, with the version it retires in its context', () => {
    expect(decided(retiringGreet, greetCreated)).toStrictEqual(
      Result.succeed([{ type: 'definition_retired', data: {} }]),
    );
    expect(contextOf(retiringGreet, greetCreated)).toStrictEqual(identified(greetRetired.context));
  });

  it('records nothing for a definition that is already retired', () => {
    expect(decided(retiringGreet, greetCreated, greetRetired)).toStrictEqual(Result.succeed([]));
  });

  it('is rejected for a definition the playbook does not have', () => {
    expect(decided(retiringGreet)).toEqual(
      Result.fail(new NotFound({ detail: 'There is no echo definition greet in this playbook' })),
    );
  });
});

describe('the definitions of a capability', () => {
  it('start empty and live in one stream named after the capability', () => {
    expect(echoDefinitions.initialState.size).toBe(0);
    expect(definitionTypeStreamOf('echo')).toBe('definitions/echo');
  });

  it('hold each definition as its events left it, its content and its overview replaced by every update', () => {
    const registry = registryAfter(
      greetCreated,
      created('wave', howdy),
      greetUpdated,
      retired('greet', '2026-10-03T08:00:00.000Z', 2),
    );

    expect([...registry.values()]).toStrictEqual([
      {
        name: 'greet',
        definition_id: greetId,
        version: 2,
        status: 'retired',
        source: { inline: '{"greeting": "Howdy"}' },
        overview: { inline: 'Greets with a howdy.' },
        created_at: '2026-10-01T09:00:00.000Z',
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: '2026-10-03T08:00:00.000Z',
        retired_at: '2026-10-03T08:00:00.000Z',
      },
      {
        name: 'wave',
        definition_id: earlierDefinitionIdOf({ ...alpha, type: 'echo', name: 'wave' }),
        version: 1,
        status: 'active',
        source: { inline: '{"greeting": "Howdy"}' },
        overview: { inline: 'Greets with a howdy.' },
        created_at: '2026-10-01T09:00:00.000Z',
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: '2026-10-01T09:00:00.000Z',
      },
    ]);
  });
});

describe('the definitions of a capability, from what their facts say', () => {
  it('refuse a fact recorded without the definition and version it is about', () => {
    const decode = Schema.decodeUnknownSync(echoDefinitions.eventSchema);
    const { definitionVersion: _version, ...unversioned } = greetUpdated.context;

    expect(() => decode({ ...greetCreated, context: creation })).toThrow('definitionType');
    expect(() => decode({ ...greetUpdated, context: unversioned })).toThrow('definitionVersion');
  });

  it('ignore an event about a definition they never saw created', () => {
    expect(registryAfter(greetUpdated, greetRetired).size).toBe(0);
  });

  it('leave the registry they evolve from untouched', () => {
    const before = registryAfter(greetCreated);

    echoDefinitions.evolve(before, greetRetired);

    expect(before.get('greet')?.status).toBe('active');
  });
});
