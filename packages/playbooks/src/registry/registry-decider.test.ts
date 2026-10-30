import { Conflict, NotFound, recordingOf, type Context } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PlaybookCommand } from './playbook-commands.ts';
import type { PlaybookEvent, RecordedPlaybookEvent } from './playbook-events.ts';
import { registryDecider } from './registry-decider.ts';

const recordedPlaybookEvent = recordingOf(registryDecider.eventSchema);

const ada = { id: 'person:user_2ada', name: 'Ada Lovelace' };

const creation = { by: ada.id, at: '2026-10-01T09:00:00.000Z' };

const change = { by: 'acme-editor', at: '2026-10-02T10:30:00.000Z' };

const alphaCreated: PlaybookEvent = {
  type: 'playbook_created',
  data: { playbook: 'alpha', name: 'Alpha', description: 'Answers sales questions', created_by: ada },
};

const alphaRetired: PlaybookEvent = { type: 'playbook_retired', data: { playbook: 'alpha' } };

const recordedWhen = new Map<PlaybookEvent, Context>([
  [alphaCreated, creation],
  [alphaRetired, change],
]);

function recorded(event: PlaybookEvent, context: Context = recordedWhen.get(event) ?? change): RecordedPlaybookEvent {
  return recordedPlaybookEvent(event, context);
}

function registryAfter(...events: readonly (PlaybookEvent | RecordedPlaybookEvent)[]) {
  return events.reduce(
    (registry, event) => registryDecider.evolve(registry, 'context' in event ? event : recorded(event)),
    registryDecider.initialState,
  );
}

function decided(command: PlaybookCommand, ...history: readonly PlaybookEvent[]) {
  return registryDecider.decide(command, registryAfter(...history));
}

function updating(name: string, description: string): PlaybookCommand {
  return { type: 'update', playbook: 'alpha', name, description, ...change };
}

const retiring: PlaybookCommand = { type: 'retire', playbook: 'alpha', ...change };

describe('creating a playbook', () => {
  const creating: PlaybookCommand = {
    type: 'create',
    playbook: 'alpha',
    name: 'Alpha',
    description: 'Answers sales questions',
    created_by: ada,
    ...creation,
  };

  it('records the playbook with the caller who created it, by id and name, and who and when as its context', () => {
    expect(decided(creating)).toStrictEqual(Result.succeed([alphaCreated]));
    expect(registryDecider.context(creating, registryAfter())).toStrictEqual(creation);
  });

  it('is rejected while an active playbook holds the id', () => {
    expect(decided(creating, alphaCreated)).toEqual(
      Result.fail(new Conflict({ detail: 'There is already a playbook alpha in this org', kind: 'taken' })),
    );
  });

  it('is rejected for the id of a retired playbook, because an id is never reused', () => {
    expect(decided(creating, alphaCreated, alphaRetired)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The playbook alpha was retired, and a playbook id is never reused', kind: 'taken' }),
      ),
    );
  });
});

describe('updating a playbook', () => {
  it('is rejected for a playbook the org does not have', () => {
    expect(decided(updating('Alpha', ''))).toEqual(
      Result.fail(new NotFound({ detail: 'There is no playbook alpha in this org' })),
    );
  });

  it('is rejected for a retired playbook', () => {
    expect(decided(updating('Alpha Sales', ''), alphaCreated, alphaRetired)).toEqual(
      Result.fail(new Conflict({ detail: 'The playbook alpha is retired and can no longer change', kind: 'retired' })),
    );
  });

  it('records nothing when nothing changes', () => {
    expect(decided(updating('Alpha', 'Answers sales questions'), alphaCreated)).toStrictEqual(Result.succeed([]));
  });

  it('records only the fields that change', () => {
    expect(decided(updating('Alpha Sales', 'Answers sales questions'), alphaCreated)).toStrictEqual(
      Result.succeed([{ type: 'playbook_updated', data: { playbook: 'alpha', name: 'Alpha Sales' } }]),
    );
    expect(decided(updating('Alpha', ''), alphaCreated)).toStrictEqual(
      Result.succeed([{ type: 'playbook_updated', data: { playbook: 'alpha', description: '' } }]),
    );
    expect(decided(updating('Alpha Sales', ''), alphaCreated)).toStrictEqual(
      Result.succeed([{ type: 'playbook_updated', data: { playbook: 'alpha', name: 'Alpha Sales', description: '' } }]),
    );
  });
});

describe('retiring a playbook', () => {
  it('is rejected for a playbook the org does not have', () => {
    expect(decided(retiring)).toEqual(Result.fail(new NotFound({ detail: 'There is no playbook alpha in this org' })));
  });

  it('records the retirement of an active playbook', () => {
    expect(decided(retiring, alphaCreated)).toStrictEqual(Result.succeed([alphaRetired]));
  });

  it('records nothing for a playbook that is already retired', () => {
    expect(decided(retiring, alphaCreated, alphaRetired)).toStrictEqual(Result.succeed([]));
  });
});

describe("an org's playbook registry", () => {
  it('starts empty', () => {
    expect(registryDecider.initialState.size).toBe(0);
  });

  it('holds each playbook as its facts left it', () => {
    const registry = registryAfter(
      alphaCreated,
      recorded(
        { type: 'playbook_created', data: { playbook: 'beta', name: 'Beta', description: '', created_by: ada } },
        creation,
      ),
      { type: 'playbook_updated', data: { playbook: 'alpha', name: 'Alpha Sales' } },
      { type: 'playbook_updated', data: { playbook: 'beta', description: 'Handles support' } },
      recorded(alphaRetired, { ...change, at: '2026-10-03T08:00:00.000Z' }),
    );

    expect([...registry.values()]).toStrictEqual([
      {
        id: 'alpha',
        name: 'Alpha Sales',
        description: 'Answers sales questions',
        status: 'retired',
        created_at: '2026-10-01T09:00:00.000Z',
        created_by: ada,
        updated_at: '2026-10-03T08:00:00.000Z',
        retired_at: '2026-10-03T08:00:00.000Z',
      },
      {
        id: 'beta',
        name: 'Beta',
        description: 'Handles support',
        status: 'active',
        created_at: '2026-10-01T09:00:00.000Z',
        created_by: ada,
        updated_at: '2026-10-02T10:30:00.000Z',
      },
    ]);
  });
});

describe('a fact', () => {
  it('about a playbook the registry never saw created leaves the registry as it was', () => {
    expect(
      registryAfter(alphaRetired, { type: 'playbook_updated', data: { playbook: 'alpha', name: 'Ghost' } }).size,
    ).toBe(0);
  });

  it('leaves the registry it evolves from untouched', () => {
    const before = registryAfter(alphaCreated);

    registryDecider.evolve(before, recorded(alphaRetired));

    expect(before.get('alpha')?.status).toBe('active');
  });
});
