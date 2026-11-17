import { NotFound, type Outcome } from '@on.auto/operations';
import { Effect, Logger, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { type Capability, defineCapability } from '../index.ts';
import type { ReadFromTheReadModel } from '../read-model-reads/read-model-definitions.ts';
import type { ListedRow } from '../read-model-reads/read-model-lists.ts';
import { type CapturedLog, capturedLogs } from '../read-model-testing/captured-logs.ts';
import { aSavedGreeting, savedWarnings } from '../read-model-testing/saved-greeting.ts';
import { weeklyContributes } from '../read-model-testing/script-operations.ts';
import { answeredBy, staged } from '../read-model-testing/staged-script.ts';
import type { RegisteredDefinition } from '../registry/definition-registry.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { harness } from '../testing/harness.ts';
import { usersCompared } from '../used-by/users-of-a-definition.ts';
import { differingFieldsOf, sameAnswer } from './same-answers.ts';
import { registeredCompared } from './staged-definitions.ts';
import { ignoredMessage, type ListedToday, listsCompared } from './staged-lists.ts';
import { readsCompared, triggersSinceCompared } from './staged-reads.ts';

const stored: RegisteredDefinition = {
  name: 'greet',
  definition_id: 'id-of-greet',
  version: 1,
  status: 'active',
  source: { inline: 'x' },
  created_at: '2026-10-01T09:00:00.000Z',
  created_by: { id: 'acme-admin', name: 'acme-admin' },
  updated_at: '2026-10-01T09:00:00.000Z',
};

const noneToday = new Map<string, RegisteredDefinition>().get('greet');

const noneInTheReadModel = new Map<string, { readonly stored: RegisteredDefinition }>().get('greet');

const weekly = { type: 'workflow', name: 'weekly', relation: 'reads' } as const;

function warned(entry: ListedRow, warnings: readonly string[]): ListedRow {
  return { ...entry, listed: { ...entry.listed, warnings } };
}

function versioned(entry: ListedRow, version: number): ListedRow {
  return { ...entry, listed: { ...entry.listed, version } };
}

function listedTodayOf(entries: readonly ListedRow[], saved: readonly string[]): readonly ListedToday[] {
  return entries.map(({ listed }) => ({ listed, saved }));
}

function flattened({ message, annotations }: CapturedLog) {
  return { message, ...annotations };
}

async function listsLogged(today: readonly ListedToday[], candidate: readonly ListedRow[]) {
  const logs = capturedLogs();
  const comparison = await Effect.runPromise(
    listsCompared('echo', today, candidate).pipe(Effect.provide(Logger.layer([logs.logger]))),
  );
  return { comparison, logged: logs.logged().map((log) => flattened(log)) };
}

const decodeDetails = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.JsonObject));

const workflow: Capability = defineCapability({
  type: 'workflow',
  title: 'workflow',
  guide: { name: 'workflow' },
  noun: { one: 'workflow', other: 'workflows' },
  describeOutput: () => 'It answered.',
  mediaType: 'application/json',
  parse: (source: string) => Effect.orDie(decodeDetails(source)),
  summarize: (details) => ({ details }),
  run: () => Effect.succeed({ output: null, record: {} }),
});

function withIdsAside(answers: unknown): string {
  return JSON.stringify(answers).replaceAll(/"definition_id":"[^"]+"/gu, '"definition_id":"made at its creation"');
}

interface Keeping {
  readonly named: string;
  readonly goals: boolean;
  readonly contributesListed: readonly unknown[];
}

const keepings: readonly Keeping[] = [
  { named: 'not kept', goals: false, contributesListed: [undefined] },
  { named: 'kept', goals: true, contributesListed: [weeklyContributes] },
];

const decodeAList = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({
      definitions: Schema.Array(
        Schema.Struct({
          details: Schema.optionalKey(Schema.Struct({ contributes: Schema.optionalKey(Schema.Json) })),
        }),
      ),
    }),
  }),
);

function contributesListedLast(answers: readonly Outcome[]): readonly unknown[] {
  return decodeAList(answers.at(-1)).output.definitions.map(({ details }) => details?.contributes);
}

describe('a read of a definition compared with the read model', () => {
  it('names the users of a definition as differing when either path finds another', () => {
    expect([usersCompared([weekly], [weekly]), usersCompared([weekly], [])]).toEqual([
      { outcome: 'matched', differing: [] },
      { outcome: 'mismatched', differing: ['used_by'] },
    ]);
  });

  it('names a definition that only one of them holds as its presence, and else the fields that differ', () => {
    expect([
      registeredCompared(noneToday, noneInTheReadModel),
      registeredCompared(stored, noneInTheReadModel),
      registeredCompared(noneToday, { stored }),
      registeredCompared({ ...stored, version: 2 }, { stored }),
    ]).toEqual([
      { outcome: 'matched', differing: [] },
      { outcome: 'mismatched', differing: ['presence'] },
      { outcome: 'mismatched', differing: ['presence'] },
      { outcome: 'mismatched', differing: ['version'] },
    ]);
  });

  it('of get_definition names a list entry that would not answer the warnings of the open, with no ledger to read', async () => {
    const { today, candidate } = await aSavedGreeting();
    const compared = (other: ReadFromTheReadModel) => Effect.runPromise(readsCompared(echo, today, other));

    expect([
      await compared(candidate),
      await compared({ ...candidate, definition: { ...candidate.definition, warnings: ['Another warning'] } }),
    ]).toEqual([
      { outcome: 'matched', differing: [] },
      { outcome: 'mismatched', differing: ['definition.warnings', 'remembered_warnings'] },
    ]);
  });
});

describe('the trigger point of a definition compared with the read model', () => {
  it('of the trigger point today answered, against the save the row names, logged and never failing', async () => {
    const logs = capturedLogs();
    await Effect.runPromise(
      Effect.all([
        triggersSinceCompared('echo', 'save-1', 'save-1'),
        triggersSinceCompared('echo', 'save-1', 'save-2'),
      ]).pipe(Effect.provide(Logger.layer([logs.logger]))),
    );

    expect(
      logs.logged().map(({ annotations }) => [annotations['read'], annotations['outcome'], annotations['differing']]),
    ).toEqual([
      ['triggers_since', 'matched', ''],
      ['triggers_since', 'mismatched', 'triggers_since'],
    ]);
  });
});

describe('two answers compared as JSON compares them', () => {
  it('are the same whatever the order of their fields, and a field left undefined is a field left out', () => {
    expect([
      sameAnswer(
        { name: 'plain', version: 2, nested: { a: 1, b: [1, 2] } },
        { nested: { b: [1, 2], a: 1 }, version: 2, name: 'plain' },
      ),
      sameAnswer({ name: 'plain', reason: undefined }, { name: 'plain' }),
      sameAnswer([1, 2], [2, 1]),
      sameAnswer([1], [1, 1]),
      sameAnswer({ name: 'plain' }, { name: 'plain', reason: 'checked' }),
      sameAnswer({ name: 'plain' }, ['plain']),
      sameAnswer(Number.NaN, Number.NaN),
      sameAnswer(null, {}),
    ]).toEqual([true, true, false, false, false, false, true, false]);
  });

  it('name the fields that differ, in order, and an answer that is no object as its value', () => {
    expect([
      differingFieldsOf(
        { version: 2, status: 'active', name: 'plain' },
        { version: 3, name: 'plain', reason: 'checked' },
      ),
      differingFieldsOf([1], [2]),
      differingFieldsOf('plain', 'plain'),
      differingFieldsOf(undefined, { name: 'plain' }),
    ]).toEqual([['reason', 'status', 'version'], ['value'], [], ['value']]);
  });

  it('compare failures by their own fields, their kind among them', () => {
    expect(
      differingFieldsOf(
        new NotFound({ detail: 'There is no probe plain' }),
        new NotFound({ detail: 'There is no version 2 of the probe plain' }),
      ),
    ).toEqual(['detail']);
  });
});

describe('a list of definitions compared with the read model', () => {
  it('ignores an entry whose warnings are those its save recorded, logged with its position and counts alone', async () => {
    const { listed } = await aSavedGreeting();
    const today = listedTodayOf(
      listed.map((entry) => warned(entry, ['Found since'])),
      savedWarnings,
    );

    expect(await listsLogged(today, listed)).toEqual({
      comparison: {
        outcome: 'ignored',
        differing: [],
        counts: { entries: 1, read_model_entries: 1, mismatched_entries: 0, ignored_entries: 1 },
      },
      logged: listed.map(({ row }) => ({
        message: ignoredMessage,
        definition_type: 'echo',
        saved_position: row.saved_position,
        warnings_today: 1,
        warnings_saved: 1,
      })),
    });
  });

  it('counts as mismatched an entry with warnings of a third kind, another field, or another number of entries', async () => {
    const { listed } = await aSavedGreeting();

    expect(
      await Promise.all([
        listsLogged(
          listedTodayOf(listed, ['Found since']),
          listed.map((entry) => warned(entry, ['A third'])),
        ),
        listsLogged(
          listedTodayOf(listed, savedWarnings),
          listed.map((entry) => versioned(entry, 9)),
        ),
        listsLogged(listedTodayOf(listed, savedWarnings), []),
      ]),
    ).toMatchObject([
      { comparison: { outcome: 'mismatched', differing: ['warnings'] } },
      { comparison: { outcome: 'mismatched', differing: ['version'] } },
      { comparison: { outcome: 'mismatched', differing: ['entries'] } },
    ]);
  });
});

describe.each(keepings)(
  'the operations of the definitions, with the read model of the definitions composed, goals $named',
  ({ goals, contributesListed }) => {
    it('answer byte for byte as today while the stage is off, and compare nothing', async () => {
      const today = await answeredBy(harness(), workflow, goals);
      const off = await staged('off', workflow, goals);

      expect(withIdsAside(off.answers)).toBe(withIdsAside(today));
      expect(off.compared).toEqual([]);
    });

    it('answer as today in shadow, each read compared with the read model and every one matched', async () => {
      const today = await answeredBy(harness(), workflow, goals);
      const shadow = await staged('shadow', workflow, goals);

      expect(contributesListedLast(today)).toEqual(contributesListed);
      expect(withIdsAside(shadow.answers)).toBe(withIdsAside(today));
      expect(new Set(shadow.compared.map(([read]) => read))).toEqual(
        new Set(['used_by', 'get_definition', 'triggers_since', 'list_definitions', 'definition_page', 'run_start']),
      );
      expect(shadow.compared.filter(([, outcome]) => outcome !== 'matched')).toEqual([]);
    });

    it('answer as today from the read model at reads and at on, run starts still compared at reads', async () => {
      const today = await answeredBy(harness(), workflow, goals);
      const [reads, on] = [await staged('reads', workflow, goals), await staged('on', workflow, goals)];

      expect([withIdsAside(reads.answers), withIdsAside(on.answers)]).toEqual([
        withIdsAside(today),
        withIdsAside(today),
      ]);
      expect([
        new Set(reads.compared.map(([read, outcome]) => `${String(read)} ${String(outcome)}`)),
        on.compared,
      ]).toEqual([new Set(['run_start matched']), []]);
    });
  },
);
