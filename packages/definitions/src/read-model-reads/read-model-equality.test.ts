import { Ledger, type ProjectedKeyedRow, StreamProjectionRefused } from '@on.auto/operations';
import type { MemoryLedger } from '@on.auto/operations/testing';
import { Effect, Exit, Logger } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { contributesIn } from '../contributions/contributes-details.ts';
import { earlierDefinitionIdOf } from '../identity/definition-ids.ts';
import { listedWith } from '../operations/answered-definitions.ts';
import { capturedLogs } from '../read-model-testing/captured-logs.ts';
import { inThePlaybook } from '../read-model-testing/in-the-playbook.ts';
import { aPausedGreeterAlwaysWrong } from '../read-model-testing/paused-greeter.ts';
import {
  aGeneratedHistory,
  aReader,
  createdIn,
  definitionsIn,
  executedIn,
  foldedVersionIn,
  namesOf,
  registriesIn,
  savedVersionsIn,
  type TypedDefinition,
  warningsSavedWith,
} from '../read-model-testing/read-model-histories.ts';
import { readModelLedgerOf } from '../read-model-testing/read-model-ledger.ts';
import { answeringAsTheReleaseBefore, savedBeforeIds } from '../read-model-testing/saved-before-ids.ts';
import { echo } from '../testing/capabilities/echo.ts';
import { usersOf } from '../used-by/definition-users.ts';
import { listedOfTheRow } from './read-model-answers.ts';
import { definitionFromTheReadModel } from './read-model-definitions.ts';
import { listFromTheReadModel } from './read-model-lists.ts';
import { pointerDisagreesMessage } from './read-model-refused.ts';
import { registeredFromTheReadModel, storedFromTheReadModel } from './read-model-stored.ts';
import { usersFromTheReadModel } from './read-model-users.ts';
import { versionFromTheReadModel } from './read-model-versions.ts';

const types: readonly [string, ...string[]] = ['echo', 'workflow', 'lookup'];

interface History {
  readonly seed: number;
  readonly goals: boolean;
}

const histories: readonly History[] = [1, 2, 3, 4, 5].flatMap((seed) => [
  { seed, goals: false },
  { seed, goals: true },
]);

const contributes = [{ goal: 'kept-going', purpose: 'Counts the runs that ended.', measures: '/ended', final: true }];

async function aLedgerOf(seed: number): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(types);
  await aGeneratedHistory(ledger.service, seed, types);
  await executedIn(ledger.service, 'workflow', {
    type: 'create',
    name: 'contributing',
    content: { source: '{}', details: { shape: 'table', contributes } },
    created_by: aReader,
    definition_id: 'id-of-contributing',
  });
  return ledger;
}

function isAContributingWorkflow({ type, registered }: TypedDefinition): boolean {
  return type === 'workflow' && contributesIn(registered.details) !== undefined;
}

async function aLedgerOfReadModelUsers(seed: number): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(types);
  await aGeneratedHistory(ledger.service, seed, types);
  return ledger;
}

async function aLedgerOfReadModelVersions(seed: number): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(types);
  await aGeneratedHistory(ledger.service, seed, types);
  return ledger;
}

const outcome = Effect.match(registeredFromTheReadModel('echo', 'greeter'), {
  onFailure: ({ because }: { readonly because: string }) => because,
  onSuccess: () => 'answered',
});

function dyingWith(ledger: MemoryLedger, defect: unknown): MemoryLedger {
  return { ...ledger, service: Ledger.of({ ...ledger.service, readProjectedRows: () => Effect.die(defect) }) };
}

const goalsKept = true;

function pointingAtThePause(rows: readonly ProjectedKeyedRow[]): readonly ProjectedKeyedRow[] {
  return rows.map((kept) => ({ ...kept, row: { ...kept.row, saved_position: 2, position: 2 } }));
}

function wrongUntilReset(ledger: MemoryLedger, resets: number): MemoryLedger {
  let reset = 0;
  const service = Ledger.of({
    ...ledger.service,
    readProjectedRows: (projection, address, query) =>
      Effect.map(ledger.service.readProjectedRows(projection, address, query), (rows) =>
        reset < resets ? pointingAtThePause(rows) : rows,
      ),
    resetStreamProjection: (projection, address) =>
      Effect.andThen(
        Effect.sync(() => {
          reset += 1;
        }),
        ledger.service.resetStreamProjection(projection, address),
      ),
  });
  return { ...ledger, service };
}

async function aPausedGreeter(): Promise<MemoryLedger> {
  const ledger = readModelLedgerOf(['echo']);
  await createdIn(ledger.service, 'greeter');
  await executedIn(ledger.service, 'echo', { type: 'pause', name: 'greeter', paused_by: aReader });
  return ledger;
}

describe('the read model of the current definitions, over histories generated from every command', () => {
  it.each(histories)(
    'answers every definition and its list entry as the registry does, history $seed, goals kept $goals',
    async ({ seed, goals }) => {
      const ledger = await aLedgerOf(seed);
      const definitions = await definitionsIn(ledger.service, types);

      const read = await Promise.all(
        definitions.map(async ({ type, registered }) => {
          const found = await inThePlaybook(ledger, storedFromTheReadModel(type, registered.name));
          return [found.stored, listedOfTheRow(echo, found.row, found.savedBy, goals)];
        }),
      );

      expect(definitions.length).toBeGreaterThan(3);
      expect(definitions.some((definition) => isAContributingWorkflow(definition))).toBe(true);
      expect(read).toEqual(
        definitions.map(({ registered }) => [
          registered,
          listedWith(echo, registered, warningsSavedWith(registered), goals),
        ]),
      );
    },
  );
});

describe('who uses each definition, in the read model of the current definitions, over generated histories', () => {
  it.each([1, 2, 3, 4, 5])('is answered as the registries answer it, history %i', async (seed) => {
    const ledger = await aLedgerOfReadModelUsers(seed);
    const registries = await Effect.runPromise(registriesIn(ledger.service, 'playbook/acme/alpha/', types));
    const used = namesOf(types);

    const read = await Promise.all(used.map((each) => inThePlaybook(ledger, usersFromTheReadModel(types, each))));

    expect(read.flat().length).toBeGreaterThan(0);
    expect(read).toEqual(used.map((each) => usersOf(registries, each)));
  });
});

describe('the saved versions in the read model of the current definitions, over generated histories', () => {
  it.each([1, 2, 3, 4, 5])('answer every saved version as the fold of its stream does, history %i', async (seed) => {
    const ledger = await aLedgerOfReadModelVersions(seed);
    const versions = savedVersionsIn(await definitionsIn(ledger.service, types));

    const read = await Promise.all(
      versions.map(async ({ type, name, version }) => {
        const found = await inThePlaybook(ledger, versionFromTheReadModel(type, name, version));
        return [found.source, found.stripped, found.putInPlaceBy];
      }),
    );
    const folded = await Promise.all(
      versions.map((address) => Effect.runPromise(foldedVersionIn(ledger.service, address))),
    );

    expect(versions.length).toBeGreaterThan(5);
    expect(read).toEqual(folded);
  });
});

describe('a row of the read model that still names no save of its version once the read model was built again', () => {
  it('is refused, and the read model of its playbook is reset no more for an hour, then once more after it', async () => {
    const { ledger, resets } = await aPausedGreeterAlwaysWrong();
    const logs = capturedLogs();

    const outcomes = await inThePlaybook(
      ledger,
      Effect.gen(function* () {
        const first = yield* outcome;
        const resetsAfterTheFirst = resets();
        const within = yield* outcome;
        const resetsWithin = resets();
        yield* TestClock.adjust('1 hour');
        const after = yield* outcome;
        return [first, resetsAfterTheFirst, within, resetsWithin, after, resets()];
      }).pipe(Effect.provide(TestClock.layer()), Effect.provide(Logger.layer([logs.logger]))),
    );

    expect(outcomes).toEqual(['pointer_disagrees', 1, 'pointer_disagrees', 1, 'pointer_disagrees', 2]);
    expect(logs.logged().map(({ level, message }) => [level, message])).toEqual([
      ['ERROR', pointerDisagreesMessage],
      ['ERROR', pointerDisagreesMessage],
    ]);
  });
});

describe('the one reset a half-open breaker of a row naming no save admits', () => {
  it('is the only one until another hour has passed, even when that reset fails', async () => {
    const { ledger, resets } = await aPausedGreeterAlwaysWrong('beta');
    const failingResets = {
      ...ledger,
      service: Ledger.of({
        ...ledger.service,
        resetStreamProjection: (projection, address) =>
          Effect.andThen(
            ledger.service.resetStreamProjection(projection, address),
            Effect.die(new Error('The reset failed')),
          ),
      }),
    };
    const beta = { org: 'acme', playbook: 'beta' };

    const outcomes = await inThePlaybook(
      failingResets,
      Effect.gen(function* () {
        const first = yield* Effect.exit(outcome);
        const within = yield* outcome;
        yield* TestClock.adjust('1 hour');
        const trial = yield* Effect.exit(outcome);
        const afterTheTrial = yield* outcome;
        return [Exit.isFailure(first), within, Exit.isFailure(trial), afterTheTrial, resets()];
      }).pipe(Effect.provide(TestClock.layer())),
      beta,
    );

    expect(outcomes).toEqual([true, 'pointer_disagrees', true, 'pointer_disagrees', 2]);
  });
});

describe('a read of the read model whose ledger refuses its rows once their checks failed twice', () => {
  it('is refused for its failed checks, and any other defect of the ledger stays a defect', async () => {
    const { ledger } = await aPausedGreeterAlwaysWrong();

    expect(
      await inThePlaybook(
        dyingWith(ledger, new StreamProjectionRefused('definitions', 'playbook/acme/alpha')),
        outcome,
      ),
    ).toBe('checks_failed');
    await expect(inThePlaybook(dyingWith(ledger, new RangeError('The disk failed')), outcome)).rejects.toThrow(
      'The disk failed',
    );
  });
});

describe('the readers of the read model, of a definition created before definitions had ids', () => {
  it('answer the id of the address it was created at, in a read and in a list, before and after it is saved again', async () => {
    const ledger = readModelLedgerOf(['echo']);
    const itsId = earlierDefinitionIdOf({ org: 'acme', playbook: 'alpha', type: 'echo', name: 'earlier' });
    await savedBeforeIds(ledger, {
      type: 'create',
      name: 'earlier',
      content: { source: '{}' },
      created_by: aReader,
      definition_id: 'never-recorded',
    });
    const created = await inThePlaybook(ledger, definitionFromTheReadModel(echo, ['echo'], 'earlier'));
    await savedBeforeIds(ledger, { type: 'update', name: 'earlier', content: { source: '{"again":true}' } });

    const read = await inThePlaybook(ledger, definitionFromTheReadModel(echo, ['echo'], 'earlier'));
    const listed = await inThePlaybook(ledger, listFromTheReadModel(echo, false, goalsKept));

    expect([created.definition.definition_id, read.definition.version, read.definition.definition_id]).toEqual([
      itsId,
      2,
      itsId,
    ]);
    expect(listed.map(({ definition_id: id }) => id)).toEqual([itsId]);
  });
});

describe('the readers of the read model, answered by an object of the release before, whose rows have no column of ids', () => {
  it('answer the id of the address each definition was created at, every definition of such an object being earlier', async () => {
    const ledger = readModelLedgerOf(['echo']);
    await savedBeforeIds(ledger, {
      type: 'create',
      name: 'earlier',
      content: { source: '{}' },
      created_by: aReader,
      definition_id: 'never-recorded',
    });

    const read = await inThePlaybook(
      answeringAsTheReleaseBefore(ledger, 'definition_id'),
      definitionFromTheReadModel(echo, ['echo'], 'earlier'),
    );

    expect(read.definition.definition_id).toBe(
      earlierDefinitionIdOf({ org: 'acme', playbook: 'alpha', type: 'echo', name: 'earlier' }),
    );
  });
});

describe('a row of the read model whose position names no save of its version', () => {
  it('resets the read model once and answers from the rows built again', async () => {
    const ledger = await aPausedGreeter();

    expect([
      (await inThePlaybook(wrongUntilReset(ledger, 1), registeredFromTheReadModel('echo', 'greeter')))?.stored.status,
      (await inThePlaybook(wrongUntilReset(ledger, 1), versionFromTheReadModel('echo', 'greeter', 1))).putInPlaceBy,
    ]).toEqual(['paused', aReader.id]);
  });
});
