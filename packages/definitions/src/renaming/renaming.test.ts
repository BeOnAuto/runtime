import { mostEventsInAMultiStreamAppend } from '@on.auto/ledger';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { echo } from '../testing/capabilities/echo.ts';
import { greet, operations } from '../testing/moving.ts';
import { renamedBesideADocumentThatNoLongerParses, renamedWhereAWorkflowCallsIt } from '../testing/renaming.ts';
import { namesNoDefinition } from '../used-by/definitions-named.ts';
import { boundRefused, mostFactsInARename } from './rename-checks.ts';
import { declaredUsesOf, renameCandidatesIn, type RenameMember } from './rename-members.ts';
import { renamedIn } from './renamed-yaml.ts';

const toSalute = { from: 'greet', to: 'salute' };

const callingGreet = [
  '# Says hello',
  'do:',
  '  - first: { call: run_definition, with: { type: echo, name: greet } } # the greeting',
  "  - second: { call: run_definition, with: { type: echo, name: 'greet' } }",
  '  - third:',
  '      call: run_definition',
  '      with: { type: echo, name: "greet", input: { greet: greet } }',
  '',
].join('\n');

const callingPlaces = ['/do/0/first/with/name', '/do/1/second/with/name', '/do/2/third/with/name'];

describe('a document renamed at the places it declares', () => {
  it('changes each place that holds the old name, as it was quoted, and nothing else', () => {
    const renamed = callingPlaces.map((pointer) => ({ pointer, from: toSalute.from, to: toSalute.to }));

    expect(renamedIn(callingGreet, 'workflow', renamed)).toBe(
      callingGreet
        .replace('name: greet }', 'name: salute }')
        .replace("'greet'", "'salute'")
        .replace('"greet"', '"salute"'),
    );
  });

  it('leaves a place that holds something else, and a document whose front matter does not close, as they are', () => {
    const workflow = 'do:\n  - first: { call: run_definition, with: { type: echo, name: other } }\n';
    const unclosed = '---\nruns: { type: echo, name: greet }\n';
    const unopened = 'runs: { type: echo, name: greet }\n';

    expect([
      renamedIn(workflow, 'workflow', [{ pointer: '/do/0/first/with/name', ...toSalute }]),
      renamedIn(workflow, 'workflow', [{ pointer: '/do/0/first', ...toSalute }]),
      renamedIn(unclosed, 'function', [{ pointer: '/runs/name', ...toSalute }]),
      renamedIn(unopened, 'function', [{ pointer: '/runs/name', ...toSalute }]),
      renamedIn(workflow, 'workflow', []),
    ]).toEqual([workflow, workflow, unclosed, unopened, workflow]);
  });

  it('renames in the front matter of a function alone, with its byte order mark and line endings kept', () => {
    const source = '\uFEFF---\r\nruns: { type: echo, name: greet }\r\n---\r\nRead the greet runs.\r\n';

    expect(renamedIn(source, 'function', [{ pointer: '/runs/name', ...toSalute }])).toBe(
      source.replace('name: greet', 'name: salute'),
    );
  });

  it('quotes a plain new name that would otherwise be read as another value', () => {
    expect(renamedIn('runs: greet\n', 'workflow', [{ pointer: '/runs', from: 'greet', to: 'null' }])).toBe(
      'runs: "null"\n',
    );
  });
});

function member(name: string): RenameMember {
  const stored = storedOf(name);
  return { type: 'echo', name, capability: echo, stored, namedAsStored: true, callsOrReads: true, ...noneDeclared };
}

const noneDeclared = { named: namesNoDefinition, usedByItsRuns: true };

function outcomeOfTheBound(renamed: RenameMember, saved: readonly RenameMember[]): string {
  return Effect.runSync(
    Effect.match(boundRefused(renamed, saved), { onFailure: () => 'refused', onSuccess: () => 'kept' }),
  );
}

function storedOf(name: string, more: object = {}) {
  return {
    name,
    definition_id: `id-of-${name}`,
    version: 1,
    status: 'active' as const,
    source: { inline: '{}' },
    created_at: '2026-11-19T09:00:00.000Z',
    created_by: { id: 'acme-admin', name: 'Ada' },
    updated_at: '2026-11-19T09:00:00.000Z',
    ...more,
  };
}

function pageFiltering(subject: string, type = 'run_succeeded') {
  const data = {
    views: {},
    language: 'typescript' as const,
    fold: '',
    foldLine: 1,
    filters: [{ type, subject }],
  };
  return { page: { details: { data } } };
}

function scheduledAndOnGreet(type: string) {
  return [
    { kind: 'cron' as const, reference: '/schedule/cron', expression: '0 9 * * *' },
    {
      kind: 'event' as const,
      reference: '/schedule/on',
      filters: [{ reference: '/schedule/on/one', type, attributes: { subject: 'echo/greet' } }],
    },
  ];
}

const greetToSalute = { type: 'echo', ...toSalute };

interface FilterWritten {
  readonly type: string;
  readonly subject: string;
}

function named(subjects: readonly FilterWritten[], awaited: readonly FilterWritten[]) {
  return {
    ...namesNoDefinition,
    subjects: subjects.map((each) => ({ pointer: '/on/0/subject', ...each })),
    awaited: awaited.map((each) => ({ pointer: '/listen/0/subject', ...each })),
  };
}

describe('the definitions a rename saves again', () => {
  it('are the renamed one and each one not retired whose page or trigger filters on its runs by their subject as written', () => {
    const registry = new Map([
      ['greet', storedOf('greet')],
      ['counts', storedOf('counts', pageFiltering('echo/greet'))],
      ['near', storedOf('near', pageFiltering('echo/greeting'))],
      ['gone', storedOf('gone', { ...pageFiltering('echo/greet'), status: 'retired' })],
      ['scheduled', storedOf('scheduled', { triggers: scheduledAndOnGreet('run_succeeded') })],
      ['published', storedOf('published', pageFiltering('echo/greet', 'com.acme.greeted'))],
      ['notified', storedOf('notified', { triggers: scheduledAndOnGreet('com.acme.greeted') })],
    ]);

    const candidates = renameCandidatesIn([echo], new Map([['echo', registry]]), greetToSalute);

    expect(candidates.filter(({ namedAsStored }) => namedAsStored).map(({ name }) => name)).toEqual([
      'greet',
      'counts',
      'scheduled',
    ]);
    expect(candidates.map(({ name }) => name)).toEqual([
      'greet',
      'counts',
      'near',
      'scheduled',
      'published',
      'notified',
    ]);
    expect(renameCandidatesIn([echo], new Map(), greetToSalute)).toEqual([]);
  });

  it('are at most as many as one append to several streams keeps, the rename among them', () => {
    const renamed = member('greet');
    const users = Array.from({ length: mostFactsInARename - 1 }, (_, index) => member(`user-${index}`));

    expect(mostFactsInARename).toBe(mostEventsInAMultiStreamAppend);
    expect([outcomeOfTheBound(renamed, users), outcomeOfTheBound(renamed, [renamed, ...users])]).toEqual([
      'kept',
      'refused',
    ]);
  });
});

describe('the uses of a renamed definition that a document declares', () => {
  it('name it where a declared place names it, and are used by its runs where they await it', () => {
    const ofItsRuns = { type: 'run_succeeded', subject: 'echo/greet' };
    const published = { type: 'com.acme.greeted', subject: 'echo/greet' };

    expect([
      declaredUsesOf(named([ofItsRuns], []), greetToSalute),
      declaredUsesOf(named([], [ofItsRuns]), greetToSalute),
      declaredUsesOf(named([published], [published]), greetToSalute),
      declaredUsesOf(
        { ...namesNoDefinition, names: [{ pointer: '/calls/0/name', type: 'echo', name: 'greet' }] },
        greetToSalute,
      ),
      declaredUsesOf(namesNoDefinition, greetToSalute),
    ]).toEqual([
      { declares: true, awaits: false },
      { declares: true, awaits: true },
      { declares: false, awaits: false },
      { declares: true, awaits: false },
      { declares: false, awaits: false },
    ]);
  });
});

describe('a rename in a playbook that holds a document its capability no longer parses', () => {
  it('leaves that definition as it is where nothing it keeps names the renamed one, and refuses to rename it', async () => {
    expect(await renamedBesideADocumentThatNoLongerParses()).toMatchObject([
      { status: 'rejected', reason: 'conflict', kind: 'unworkable' },
      { status: 'succeeded', output: { type: 'echo', name: 'salute' } },
    ]);
  });
});

const renameOfGreet = { ...greet, new_name: 'salute' };

const savedAgain = (...names: readonly string[]): readonly Readonly<Record<string, string>>[] =>
  names.map((name) => ({ type: 'workflow', name }));

describe('the words of a rename', () => {
  it('are told apart from an update, and as none, one or several definitions saved again', async () => {
    const { updated_definitions: saved, ...alone } = await renamedWhereAWorkflowCallsIt(renameOfGreet);
    const plainLanguage = operations.updateDefinition.registration.plainLanguage;
    const outcomes = [saved, savedAgain('report', 'weekly')].map((updated) =>
      plainLanguage?.outcome({ ...alone, updated_definitions: updated }, renameOfGreet),
    );

    expect(saved).toEqual(savedAgain('weekly'));
    expect(new Set([plainLanguage?.outcome(alone, renameOfGreet), ...outcomes]).size).toBe(3);
    expect(plainLanguage?.attempt(renameOfGreet)).not.toBe(plainLanguage?.attempt({ ...greet, source: '{}' }));
  });
});
