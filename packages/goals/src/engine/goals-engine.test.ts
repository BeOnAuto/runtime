import { PlaybookRegistry, factTypesOf } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import type { HostDatabase } from '@on.auto/workflow-host';
import { Effect, Function, type SchemaAST } from 'effect';
import { describe, expect, it } from 'vitest';

import { bookOf, controls, delivering, finished } from '../assessor/assessor-ledger.ts';
import { goalsLedger } from './goals-engine.ts';
import { goalsHostParts, goalsHostPartsWhere, goalsKeptNowhere, type GoalsPorts } from './goals-host-parts.ts';

const asked: string[] = [];

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

const namesOf = ({ consumers, dueWork, playbookOperations }: ReturnType<typeof goalsHostParts>) => ({
  consumers: consumers.map(({ name }) => name),
  dueWork: dueWork.map(({ name }) => name),
  operations: playbookOperations.map(({ registration }) => registration.name),
});

const portsOfAHost = (): GoalsPorts => {
  asked.push('ports');
  return {
    database,
    ledger: memoryLedger().service,
    registry: PlaybookRegistry.of({ status: () => Effect.succeed('active') }),
    callers: { serviceCallers: new Set() },
    filters: { session: unused, clock: () => 0 },
    now: () => 0,
  };
};

describe('the goals engine', () => {
  it('gives every host the facts of assessments, of summaries and of refused observations, on every host whatever its switch', () => {
    expect(
      goalsLedger.factSchemas.flatMap((schema: { readonly ast: SchemaAST.AST }) => factTypesOf(schema)).toSorted(),
    ).toEqual([
      'goal_assessed',
      'goal_assessment_ended',
      'goal_assessment_opened',
      'goal_notice_refused',
      'goal_notice_refused',
      'goal_notice_started',
      'goal_observation_refused',
      'goal_observed',
      'goal_overdue',
      'goal_stopped',
      'goal_summary_started',
    ]);
    expect(goalsLedger.layoutSteps).toEqual([{ layout: 24, statements: [] }]);
  });

  it('makes its consumers, due work and operations over the ports of a host that keeps goals', () => {
    expect(namesOf(goalsHostPartsWhere(true, portsOfAHost))).toEqual(namesOf(goalsHostParts(portsOfAHost())));
    expect(namesOf(goalsHostParts(portsOfAHost()))).toEqual({
      consumers: ['goal assessments'],
      dueWork: ['the clock of the goals', 'the stopped things of the goals caught up'],
      operations: [],
    });
    expect(asked).toEqual(['ports', 'ports', 'ports']);
  });

  it('makes nothing, and asks for no port, where goals are not kept', () => {
    asked.length = 0;

    expect(goalsHostPartsWhere(false, portsOfAHost)).toBe(goalsKeptNowhere);
    expect(goalsKeptNowhere).toEqual({ consumers: [], dueWork: [], playbookOperations: [] });
    expect(asked).toEqual([]);
  });
});

describe('the assessor of the goals engine', () => {
  it("reads who began a run that is not a schedule's from the host's database, and fails its delivery while it cannot", async () => {
    const book = bookOf();
    await book.goalsSaved([controls]);
    await book.workflowSaved('measure', 1, [{ goal: 'controls-hold', purpose: 'Counts failures.', measures: '/n' }]);
    const { consumers } = goalsHostParts({ ...portsOfAHost(), ledger: book.ledger });
    const child = finished({ id: 'child', context: { by: 'playbook:sales' } });
    const called = { ...child, record: { ...child.record, correlationId: 'top' } };

    const delivered = await Effect.runPromise(Effect.forEach(consumers, (consumer) => delivering(consumer, called)));

    expect(delivered).toEqual([{ keys: [], failed: ['!'], batches: 1 }]);
  });
});
