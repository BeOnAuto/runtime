import {
  allPermissions,
  changeCatalogOf,
  makeDispatcher,
  type CallerIdentity,
  type PlaybookRequest,
  type RouteRegistration,
} from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { goalsSavedWordsOf } from '@on.auto/playbooks';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { assessmentBookOf, controlsGoal, experimentsGoal, firstDay } from './assessment-samples.ts';
import { getPlaybookGoals, goalsReadIn, goalsReadWith } from './get-playbook-goals.ts';
import { goalChangeNamings } from './goal-changes.ts';
import { goalsOperationsServed } from './goals-operations.ts';
import type { NoticesDelivered } from './notices-delivered.ts';

const reader: CallerIdentity = {
  id: 'acme-reader',
  name: 'acme-reader',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

function readOfAnEmptyPlaybook(
  registration: RouteRegistration<'playbook'> = getPlaybookGoals.registration,
  input: Readonly<Record<string, string>> = {},
) {
  const ledger = memoryLedger();
  const services = Layer.mergeAll(
    ledger.layer,
    memoryPlaybookRegistry([{ org: 'acme', playbook: 'alpha' }]),
    recordingReporter().layer,
  );
  const request: PlaybookRequest = { caller: reader, org: 'acme', playbook: 'alpha', input, encoding: 'strings' };
  return Effect.runPromise(makeDispatcher([]).dispatchToPlaybook(registration, request).pipe(Effect.provide(services)));
}

describe('the goals read as an operation', () => {
  it('is served over HTTP alone at GET /goals of a playbook beside agree_playbook_goals, get_goal_day, list_goal_results and dismiss_goal_thing, and only where goals are kept', () => {
    const [kept, ...beside] = goalsOperationsServed(true);

    expect(goalsOperationsServed(false)).toEqual([]);
    expect(beside.map(({ registration }) => registration.name)).toEqual([
      'agree_playbook_goals',
      'get_goal_day',
      'list_goal_results',
      'dismiss_goal_thing',
    ]);
    expect(kept?.registration).toMatchObject({
      name: 'get_playbook_goals',
      scope: 'playbook',
      route: { method: 'GET', path: '/goals' },
      servedOverHttpAlone: { kind: 'none' },
    });
  });

  it('answers a playbook with no goals from its own ledger: no goals and the gap no_goal', async () => {
    const read = await readOfAnEmptyPlaybook();

    expect(read).toMatchObject({
      status: 'succeeded',
      output: { gaps: [{ kind: 'no_goal', fixed_by: 'person' }], goals: [] },
    });
    expect(read).not.toHaveProperty('output.version');
  });
});

describe('the query of the goals read', () => {
  it('takes a time zone, a number of days up to thirty-one, the last day and whether to include dismissed things', async () => {
    const asked = await readOfAnEmptyPlaybook(getPlaybookGoals.registration, {
      time_zone: 'America/Los_Angeles',
      days: '31',
      until: '2026-11-16',
      dismissed: 'include',
    });

    expect(asked).toMatchObject({ status: 'succeeded', output: { goals: [] } });
  });

  it.each([
    [{ time_zone: 'Mars/Olympus' }, '/time_zone'],
    [{ time_zone: 'UTC', days: '32' }, '/days'],
    [{ time_zone: 'UTC', days: '0' }, '/days'],
    [{ time_zone: 'UTC', until: '2026-02-30' }, '/until'],
    [{ zone: 'UTC' }, '/zone'],
    [{ dismissed: 'all' }, '/dismissed'],
  ])('refuses %o at %s', async (input: Readonly<Record<string, string>>, pointer: string) => {
    expect(await readOfAnEmptyPlaybook(getPlaybookGoals.registration, input)).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer }],
    });
  });
});

function outcomeOf(messages: boolean) {
  return goalsOperationsServed(true, true, messages)[1]?.registration.plainLanguage?.outcome(
    { goals: [] },
    { goals: [{ id: 'weekly-leads', version: 1 }] },
  );
}

describe('whether the goals read says the engine judges the goals', () => {
  it('answers results true where the engine runs and false where the goals are kept with no engine', async () => {
    const [judged] = goalsOperationsServed(true, true);
    const [kept] = goalsOperationsServed(true, false);

    expect(goalsOperationsServed(false, true)).toEqual([]);
    expect(await readOfAnEmptyPlaybook(judged?.registration)).toMatchObject({ output: { results: true } });
    expect(await readOfAnEmptyPlaybook(kept?.registration)).toMatchObject({ output: { results: false } });
  });

  it('serve the yes that says no goal messages are sent only where messages are off', () => {
    expect(outcomeOf(false)).toBe(`${String(outcomeOf(true))}${goalsSavedWordsOf(false)}`);
  });
});

describe('the goal change', () => {
  const fact = { id: 'fact-1', type: 'goal_created', context: { at: '2026-10-05T09:00:00.000Z', by: 'x' } };

  it('is named, with no fields, for a goal saved, agreed or removed or evidence refused, where goals are kept', () => {
    const catalog = changeCatalogOf(goalChangeNamings(true));

    expect(
      ['goal_created', 'goal_updated', 'goal_reordered', 'goal_agreed', 'goal_removed'].flatMap((type) =>
        catalog.changesOf({ ...fact, type, stream: 'goals/goal' }),
      ),
    ).toEqual(Array.from({ length: 5 }, () => ({ kind: 'goal' })));
    expect(catalog.changesOf({ ...fact, type: 'playbook_goals_saved', stream: 'goals/playbook' })).toEqual([]);
    expect(catalog.changesOf({ ...fact, type: 'goal_observation_refused', stream: 'goal-refusals' })).toEqual([
      { kind: 'goal' },
    ]);
    expect(catalog.kinds.map(({ kind }) => kind)).toEqual(['goal']);
    expect(goalChangeNamings(false)).toEqual([]);
  });
});

const rejected = {
  rejection: { reason: 'unanswered', kind: 'expired', detail: 'The request expired before it was delivered' },
};

const undelivered: NoticesDelivered = (notices) =>
  Effect.succeed(notices.map((notice) => ({ ...notice, delivered: false })));

describe('the goals read of a playbook whose goals are judged', () => {
  it('answers each goal with its assessments from the tables, and the delivered flag where it is joined', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal, controlsGoal]);
    const id = await book.opened(experimentsGoal, firstDay, { per: 'MAR-41' });
    await book.observed(id, firstDay, { marks: 'chosen' });
    await book.noticeStarted(id, 'passed', firstDay + 1000);

    const read = await book.inThePlaybook(goalsReadWith(undelivered));
    const plain = await book.inThePlaybook(goalsReadIn);

    expect(read.goals.map(({ id: goal, assessments }) => [goal, assessments.open_count])).toEqual([
      [experimentsGoal.id, 1],
      [controlsGoal.id, 0],
    ]);
    expect(read.goals[0]?.assessments.current?.notices).toEqual([
      { change: 'passed', at: '2026-11-02T00:00:01.000Z', run: 'notice-passed', delivered: false },
    ]);
    expect(plain.goals[0]?.assessments.current?.notices).toEqual([
      { change: 'passed', at: '2026-11-02T00:00:01.000Z', run: 'notice-passed' },
    ]);
  });
});

describe('the goals read of a playbook whose notices have ended', () => {
  it('reads whether each notice was delivered from its own run, and shows the newest undelivered one as a gap', async () => {
    const book = assessmentBookOf();
    await book.goalsSaved([experimentsGoal]);
    const id = await book.opened(experimentsGoal, firstDay, { per: 'MAR-41' });
    await book.observed(id, firstDay, { marks: 'chosen' });
    await book.noticeStarted(id, 'passed', firstDay + 1000);
    await book.noticeStarted(id, 'overdue', firstDay + 2000);
    await book.noticeEnded('passed', 'run_succeeded', { output: null, record: {} }, firstDay + 3000);
    await book.noticeEnded('overdue', 'run_rejected', rejected, firstDay + 4000);

    const [goal] = (await book.inThePlaybook(goalsReadIn)).goals;

    expect(goal?.assessments.current?.notices).toEqual([
      { change: 'passed', at: '2026-11-02T00:00:01.000Z', run: 'notice-passed', delivered: true },
      { change: 'overdue', at: '2026-11-02T00:00:02.000Z', run: 'notice-overdue', delivered: false },
    ]);
    expect(goal?.gaps.find(({ kind }) => kind === 'notice_undelivered')?.detail).toMatch(
      /^The message saying the goal [^ ]+ became overdue was not delivered: its run was rejected: The request expired/u,
    );
  });
});
