import { Conflict, NotFound, type Context, type DefinitionContext } from '@on.auto/operations';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { recordedAdmin } from '../testing/callers.ts';
import type { DefinitionCommand } from './definition-commands.ts';
import type { DefinitionContent, RecordedDefinitionEvent } from './definition-events.ts';
import { definitionsDecider, definitionTypeStreamOf } from './definitions-decider.ts';

const echoDefinitions = definitionsDecider('echo');

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

const creatingGreet: DefinitionCommand = { type: 'create', name: 'greet', content: hello, ...asTheAdmin };

function updatingGreet(content: DefinitionContent): DefinitionCommand {
  return { type: 'update', name: 'greet', content, ...change };
}

const retiringGreet: DefinitionCommand = { type: 'retire', name: 'greet', ...change };

describe('creating a definition', () => {
  it('records its content, with the definition at version 1, who created it and when as its context', () => {
    expect(decided(creatingGreet)).toStrictEqual(
      Result.succeed([{ type: 'definition_created', data: { content: hello, created_by: recordedAdmin } }]),
    );
    expect(contextOf(creatingGreet)).toStrictEqual(greetCreated.context);
  });

  it('is rejected while an active definition holds the name', () => {
    expect(decided(creatingGreet, greetCreated)).toEqual(
      Result.fail(new Conflict({ detail: 'The playbook already has the echo definition greet', kind: 'taken' })),
    );
  });

  it('is rejected for the name of a retired definition, because a name is never reused', () => {
    expect(decided(creatingGreet, greetCreated, greetRetired)).toEqual(
      Result.fail(
        new Conflict({
          detail: 'The echo definition greet was retired, and a definition name is never reused',
          kind: 'taken',
        }),
      ),
    );
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
      greetUpdated.context,
      ofTheDefinition('greet', change, 3),
      { ...change, definitionType: 'echo', definitionName: 'greet' },
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
        new Conflict({ detail: 'The echo definition greet is retired and can no longer change', kind: 'retired' }),
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
    expect(contextOf(retiringGreet, greetCreated)).toStrictEqual(greetRetired.context);
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
        version: 2,
        status: 'retired',
        source: '{"greeting": "Howdy"}',
        overview: 'Greets with a howdy.',
        created_at: '2026-10-01T09:00:00.000Z',
        created_by: { id: 'acme-admin', name: 'acme-admin' },
        updated_at: '2026-10-03T08:00:00.000Z',
        retired_at: '2026-10-03T08:00:00.000Z',
      },
      {
        name: 'wave',
        version: 1,
        status: 'active',
        source: '{"greeting": "Howdy"}',
        overview: 'Greets with a howdy.',
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

const threeTriggers: DefinitionContent['triggers'] = [
  { kind: 'event', reference: '/schedule/on', filters: [{ reference: '/schedule/on/one', type: 'x', attributes: {} }] },
  { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * *' },
  { kind: 'every', reference: '/schedule/every', milliseconds: 60_000 },
];

const reacting: DefinitionContent = {
  source: '{"greeting": "Hello", "triggers": "three"}',
  triggers: threeTriggers,
};

function reactingDefinitions(count: number): readonly RecordedDefinition[] {
  return Array.from({ length: count }, (_, index) => created(`reacting-${index}`, reacting));
}

const beyondTheBound = new Conflict({
  detail:
    'The playbook already has 1024 echo definitions that start on their own, the most a playbook holds; retire one, or save this one without its schedule',
});

describe('the definitions of a playbook that start on their own', () => {
  it('are 1,024 at most, however many triggers each has: one more is refused, created or made so by an update', () => {
    const full = reactingDefinitions(1024);

    expect([
      decided({ ...creatingGreet, content: reacting }, ...full),
      decided(updatingGreet(reacting), greetCreated, ...full),
      decided({ ...creatingGreet, content: hello }, ...full),
    ]).toEqual([
      Result.fail(beyondTheBound),
      Result.fail(beyondTheBound),
      Result.succeed([{ type: 'definition_created', data: { content: hello, created_by: recordedAdmin } }]),
    ]);
  });

  it('are counted after a version replaces another, and without the retired ones', () => {
    const almost = reactingDefinitions(1023);
    const reactingGreet = created('greet', reacting);

    expect([
      Result.isSuccess(
        decided(
          updatingGreet({ ...reacting, source: '{"greeting": "Hi", "triggers": "three"}' }),
          reactingGreet,
          ...almost,
        ),
      ),
      Result.isSuccess(
        decided(
          { ...creatingGreet, name: 'other', content: reacting },
          ...reactingDefinitions(1024),
          retired('reacting-0'),
        ),
      ),
    ]).toEqual([true, true]);
  });
});
