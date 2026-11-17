import { makeAppRuntime } from '@on.auto/api';
import { goalsKeptNowhere, type GoalsHostParts } from '@on.auto/goals';
import { memoryLedger, memoryPlaybookRegistry } from '@on.auto/operations/testing';
import type { Consumer, DueWork, HostDatabase } from '@on.auto/workflow-host';
import { Effect, Function, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { hostListsWithTheGoalsEngine, servedWithTheGoalsEngine } from './goals-engine-lists.ts';

const consumerNamed = (name: string): Consumer => ({
  name,
  types: ['run_succeeded'],
  skippedAfterSweeps: 20,
  batchOf: () => Effect.succeed({ deliveries: [], through: undefined, more: false }),
});

const dueWorkNamed = (name: string): DueWork => ({
  name,
  due: () => Effect.succeed([]),
  nextDueAt: () => Effect.succeed(null),
});

const engine: GoalsHostParts = {
  consumers: [consumerNamed('assessor')],
  dueWork: [dueWorkNamed('goal clock')],
  playbookOperations: [],
};

const own = { consumers: [consumerNamed('own')], dueWork: [dueWorkNamed('requests')] };

describe('the lists a server gives its host, with the goals engine', () => {
  it('hold the host’s own consumers and due work, then the engine’s', () => {
    const lists = hostListsWithTheGoalsEngine(own, engine);

    expect([lists.consumers.map(({ name }) => name), lists.dueWork.map(({ name }) => name)]).toEqual([
      ['own', 'assessor'],
      ['requests', 'goal clock'],
    ]);
  });

  it('hold the host’s own alone where goals are not kept', () => {
    expect(hostListsWithTheGoalsEngine(own, goalsKeptNowhere)).toEqual(own);
  });
});

const unused = () => Promise.reject(new Error('A port the goals engine does not use yet'));

const dies = () => Effect.die(new Error('A port the goals engine does not use yet'));

const database: HostDatabase = {
  store: {
    mostEventsInOneAppend: 100,
    read: unused,
    readPage: unused,
    append: unused,
    pointLength: 16,
    readRecorded: unused,
    readAppended: unused,
    readAppendedFacts: unused,
    readRecordedEvent: unused,
    readRecordedOfKeys: unused,
    readRecordedEventOfKeys: unused,
    definitionStreams: unused,
    ageOfLastAppend: unused,
    versionOf: unused,
    messageAt: unused,
    lastMessageOf: unused,
    waitForAppend: unused,
    endWaits: Function.constVoid,
  },
  appendWith: unused,
  read: dies,
  write: dies,
  transaction: dies,
  readConsistently: dies,
  sharedClock: null,
  mostBoundValues: 100,
  content: { put: dies, get: dies, getHead: dies, getPart: dies },
};

const filters = { session: unused, clock: () => 0 };

describe('the lists a server serves with the goals engine', () => {
  it('are its own due work and operations and the engine’s parts, whether goals are kept or not', async () => {
    const due = own.dueWork;
    const runtime = await makeAppRuntime(Layer.mergeAll(memoryLedger().layer, memoryPlaybookRegistry([])));
    const pool = { evaluations: { filters } };
    const names = async (goals: boolean, now?: () => number) => {
      const lists = await servedWithTheGoalsEngine({ goals, runtime, database, pool, now }, due, []);
      return [lists.consumers.length, lists.dueWork.map(({ name }) => name), lists.playbookOperations.length];
    };

    expect(await Promise.all([names(true), names(true, () => 0), names(false)])).toEqual([
      [1, ['requests', 'the clock of the goals', 'the stopped things of the goals caught up'], 0],
      [1, ['requests', 'the clock of the goals', 'the stopped things of the goals caught up'], 0],
      [0, ['requests'], 0],
    ]);
  });
});
