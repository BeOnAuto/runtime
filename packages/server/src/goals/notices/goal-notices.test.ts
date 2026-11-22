import { type GoalsPorts, summaryRunIdOf, windowOpeningAfter } from '@on.auto/goals';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { noticeHeadline, tellOwner, type NoticedIds } from '../../testing/goals/notice-facts.ts';
import { type NoticeServer, playbookToldBy, servingGoalNotices } from '../../testing/goals/notice-servers.ts';
import { wokenClock, type WokenClock } from '../../testing/goals/woken-clock.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { isStarted, whenSwept } from '../../testing/servers/workflow-server.ts';
import { createdWithGoals } from '../../testing/settings/goals-kept.ts';
import { fewSweeps, testServersStartAt } from '../../testing/waiting/stepped-server-clock.ts';
import { whenHeld } from '../../testing/waiting/until.ts';
import { goalLinksOnNode } from './goal-links.ts';

const GapsSchema = Schema.Struct({
  goals: Schema.Array(Schema.Struct({ id: Schema.String, gaps: Schema.Array(Schema.Struct({ kind: Schema.String })) })),
});

const startedFacts = ['goal_assessment_opened', 'goal_assessed', 'goal_notice_started'];

function assessmentFactsOf(served: NoticeServer, { goal, assessment }: NoticedIds): Promise<readonly string[]> {
  return served.factsOf(goal, `assessments/${assessment}`);
}

function noticeStartedIn(served: NoticeServer, ids: NoticedIds): Promise<readonly string[]> {
  return whenHeld(
    () => assessmentFactsOf(served, ids),
    (facts) => facts.includes('goal_notice_started'),
  );
}

const summaryStream = 'goal-summaries/summary';

async function noticeGapsOf(served: NoticeServer): Promise<readonly string[]> {
  const read = Schema.decodeUnknownSync(GapsSchema)((await served.server.call('GET', `${alpha}/goals`)).body);
  return read.goals.flatMap(({ gaps }) => gaps.map(({ kind }) => kind)).filter((kind) => kind.startsWith('notice_'));
}

const goal = 'weekly-orders';

const summarisedGoals = [
  `- id: ${goal}`,
  '  statement: Keep the weekly orders coming in from the shop.',
  '  success:',
  '    label: Orders this week',
  '    settles: on_crossing',
  '    target: { at_least: 20 }',
  '    passed: Orders came in',
  '    failed: Orders fell short',
  '  notify:',
  '    passed: summary',
  '    failed: summary',
  '    through: tell-owner',
  "    summary: { cron: '0 9 * * 5' }",
  '',
].join('\n');

const headline = 'Keep the weekly orders coming in from the shop: 0 passed, 0 failed, 0 with no result';

const GapsSchemaGoalSummaries = Schema.Struct({
  goals: Schema.Array(Schema.Struct({ gaps: Schema.Array(Schema.Struct({ kind: Schema.String })) })),
});

function nextFridayAfter(at: number): number {
  return Result.getOrThrow(windowOpeningAfter({ kind: 'cron', expression: '0 9 * * 5' }, at)) ?? at;
}

async function summarisingPlaybook(served: NoticeServer): Promise<void> {
  const created = await createdWithGoals(served.server, { goals: summarisedGoals });
  const saved = await served.server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'tell-owner', source: tellOwner.replace('expires: PT4H', 'expires: P10D'), diagram: 'none' },
  });
  expect([created.status, saved.status]).toEqual([201, 201]);
}

async function gapsOf(served: NoticeServer): Promise<readonly string[]> {
  const read = Schema.decodeUnknownSync(GapsSchemaGoalSummaries)(
    (await served.server.call('GET', `${alpha}/goals`)).body,
  );
  return read.goals.flatMap(({ gaps }) => gaps.map(({ kind }) => kind)).filter((kind) => kind.startsWith('notice_'));
}

const goalRetiredGoals = 'retired-orders';

const day = 86_400_000;

const hour = 3_600_000;

const midnightAfter = (instant: number) => Math.floor(instant / day) * day + day;

const goalsWith = (window: string) =>
  [
    `- id: ${goalRetiredGoals}`,
    '  statement: Every day brings in an order from the shop.',
    `  window: ${window}`,
    '  success:',
    '    label: Orders today',
    '    settles: on_crossing',
    '    target: { at_least: 1 }',
    '    passed: An order came in',
    '    failed: No order came in',
    '  notify:',
    '    passed: now',
    '    failed: now',
    '    overdue: now',
    '    through: tell-owner',
    "    summary: { cron: '0 * * * *' }",
    '',
  ].join('\n');

const dailyAndHourly = goalsWith('{ calendar: day, grace: PT1H }');

interface Counted {
  readonly served: NoticeServer;
  readonly clock: WokenClock;
  readonly performs: () => number;
}

async function retiredPlaybook(): Promise<Counted> {
  const clock = wokenClock(testServersStartAt);
  const counted = { clock: 0 };
  const served = await servingGoalNotices({
    clock,
    goalsPortsOver: (ports: GoalsPorts): GoalsPorts => ({
      ...ports,
      registry: {
        status: (address) =>
          Effect.andThen(
            Effect.sync(() => {
              counted.clock += 1;
            }),
            ports.registry.status(address),
          ),
      },
    }),
  });
  const created = await createdWithGoals(served.server, { goals: dailyAndHourly });
  const saved = await served.server.call('POST', `${alpha}/definitions/interaction`, {
    body: { name: 'tell-owner', source: tellOwner.replace('expires: PT4H', 'expires: P30D'), diagram: 'none' },
  });
  const retired = await served.server.call('POST', `${alpha}/retire`, { body: {} });
  expect([created.status, saved.status, retired.status]).toEqual([201, 201, 200]);
  return { served, clock, performs: () => counted.clock + served.performs() };
}

const settledAt = (counted: Counted, at: number): Promise<number> => counted.clock.quietAt(at, counted.performs);

async function daysFrom(
  counted: Counted,
  midnight: number,
  left: number,
): Promise<readonly (readonly [boolean, number])[]> {
  if (left === 0) {
    return [];
  }
  const atMidnight = await settledAt(counted, midnight + 1000);
  const between = await settledAt(counted, midnight + day - 1000);
  return [[atMidnight > 0, between], ...(await daysFrom(counted, midnight + day, left - 1))];
}

const studio = { origin: 'https://studio.example', served: false };

const place = { playbook: 'alpha', goal: 'paying-customers', per: 'experiment-7' };

describe('a verdict the owner asked to hear of now, on a Node server that keeps goals', () => {
  it('leads to exactly one delivered notice, with the words of the goal, which a second start does not repeat', async () => {
    const served = await servingGoalNotices();
    await playbookToldBy(served);
    const ids = await served.assessed('now', served.server.runsOn.now());

    const posted = await whenSwept(
      served.server,
      () => served.chat.chat.posted(),
      (messages) => messages.length > 0,
    );
    const settled = await served.server.settled(ids.passedRun);
    const facts = await noticeStartedIn(served, ids);
    const { start } = await served.starting();
    await Effect.runPromise(
      start({
        org: 'acme',
        playbook: 'alpha',
        type: 'interaction',
        name: 'tell-owner',
        runId: ids.passedRun,
        input: { headline: 'Again' },
        trigger: { kind: 'goal', reference: `goals/${ids.goal}/assessments/${ids.assessment}` },
      }),
    );

    expect(posted).toMatchObject([{ text: noticeHeadline }]);
    expect(settled).toMatchObject({ status: 'succeeded' });
    expect(facts).toEqual(startedFacts);
    expect(served.chat.chat.posted()).toHaveLength(1);
    expect(await served.runs()).toEqual([ids.passedRun]);
    expect(await assessmentFactsOf(served, ids)).toEqual(startedFacts);
  });
});

describe('a verdict told now when the server stops before its notice starts', () => {
  it('loses nothing to a stop between the verdict and the start: the due column starts it when the server is back', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const before = await servingGoalNotices({ ledger, notices: false });
    await playbookToldBy(before);
    const ids = await before.assessed('now', before.server.runsOn.now());
    const runsBefore = await before.runs();
    await before.server.stop();
    const after = await servingGoalNotices({ ledger });

    expect(runsBefore).toEqual([]);
    expect(await noticeStartedIn(after, ids)).toEqual(startedFacts);
    expect(await after.server.settled(ids.passedRun)).toMatchObject({ status: 'succeeded' });
    expect(await after.runs()).toEqual([ids.passedRun]);
  });
});

describe('a notice through a paused function, on a Node server that keeps goals', () => {
  it('is refused at once and shows as a gap, and nothing is sent', async () => {
    const served = await servingGoalNotices();
    await playbookToldBy(served);
    const paused = await served.server.call('POST', `${alpha}/definitions/interaction/tell-owner/pause`, { body: {} });
    const ids = await served.assessed('now', served.server.runsOn.now());
    const gaps = await whenSwept(
      served.server,
      () => noticeGapsOf(served),
      (kinds) => kinds.length > 0,
    );

    expect(paused.status).toBe(200);
    expect(gaps).toEqual(['notice_not_started']);
    expect(await assessmentFactsOf(served, ids)).toEqual([
      'goal_assessment_opened',
      'goal_assessed',
      'goal_notice_refused',
    ]);
    expect(served.performs()).toBe(1);
    expect(served.chat.chat.posted()).toEqual([]);
  });
});

describe('the summary of a goal on a Node server that keeps goals', () => {
  it('is sent at the time of its schedule as a heartbeat with no lines, once, and its start is recorded', async () => {
    const clock = wokenClock(testServersStartAt);
    const served = await servingGoalNotices({ clock });
    await summarisingPlaybook(served);
    const identity = await served.goalOf(goal);
    const friday = nextFridayAfter(clock.now());
    clock.moveTo(friday + 1000);
    const posted = await clock.swept.until(
      () => served.chat.chat.posted(),
      (messages) => messages.length > 0,
      fewSweeps,
    );
    const facts = await clock.swept.until(
      () => served.factsOf(identity, summaryStream),
      (types) => types.includes('goal_summary_started'),
      fewSweeps,
    );
    const settled = await clock.swept.until(
      async () => (await served.server.call('GET', `${alpha}/runs/${summaryRunIdOf(identity, friday)}`)).body,
      (run) => !isStarted(run),
      fewSweeps,
    );
    await clock.quietAt(friday + 2 * 60_000, served.performs);

    expect(posted).toMatchObject([{ text: headline }]);
    expect(facts).toEqual(['goal_summary_started']);
    expect(settled).toMatchObject({ status: 'succeeded' });
    expect(await served.runs()).toEqual([summaryRunIdOf(identity, friday)]);
    expect(served.chat.chat.posted()).toHaveLength(1);
    expect(served.performs()).toBe(1);
  });

  it('is refused through a paused function, sends nothing and shows as a gap', async () => {
    const clock = wokenClock(testServersStartAt);
    const served = await servingGoalNotices({ clock });
    await summarisingPlaybook(served);
    const paused = await served.server.call('POST', `${alpha}/definitions/interaction/tell-owner/pause`, { body: {} });
    clock.moveTo(nextFridayAfter(clock.now()) + 1000);

    const gaps = await clock.swept.until(
      () => gapsOf(served),
      (kinds) => kinds.length > 0,
      fewSweeps,
    );

    expect(paused.status).toBe(200);
    expect(gaps).toEqual(['notice_not_started']);
    expect(await served.factsOf(await served.goalOf(goal), summaryStream)).toEqual(['goal_notice_refused']);
    expect(await served.runs()).toEqual([]);
    expect(served.chat.chat.posted()).toEqual([]);
  });
});

describe('a retired playbook on a Node server whose goal has a daily window and an hourly summary', () => {
  it('is performed on only once a day by its clock, notices and summaries, and sends its summary after a restore', async () => {
    const counted = await retiredPlaybook();
    const nextHour = (Math.floor(counted.clock.now() / hour) + 1) * hour;
    const firstMidnight = midnightAfter(nextHour);
    const atTheHour = await settledAt(counted, nextHour + 1000);
    const days = await daysFrom(counted, firstMidnight, 2);
    const postedWhileRetired = counted.served.chat.chat.posted().length;
    const restored = await counted.served.server.call('POST', `${alpha}/restore`, { body: {} });
    const resumedAt = firstMidnight + 2 * day;
    counted.clock.moveTo(resumedAt + 1000);
    const posted = await counted.clock.swept.until(
      () => counted.served.chat.chat.posted(),
      (messages) => messages.length > 0,
      fewSweeps,
    );

    expect(atTheHour).toBeGreaterThan(0);
    expect(days).toEqual([
      [true, 0],
      [true, 0],
    ]);
    expect(postedWhileRetired).toBe(0);
    expect(restored.status).toBe(200);
    expect(posted).toHaveLength(1);
    const identity = await counted.served.goalOf(goalRetiredGoals);
    expect(await counted.served.runs()).toContain(summaryRunIdOf(identity, resumedAt));
  });
});

describe('the Studio address of a goal a Node server makes with no request in progress', () => {
  it('opens Studio on the runtime at the address the server is configured with', () => {
    expect(goalLinksOnNode(studio, () => 'https://runtime.example')(place)).toBe(
      'https://studio.example/?server=https%3A%2F%2Fruntime.example&src=agent&playbook=alpha&goal=paying-customers&per=experiment-7',
    );
  });

  it('opens the Studio the server serves itself, on the loopback', () => {
    expect(
      goalLinksOnNode({ ...studio, served: true }, () => 'http://127.0.0.1:5575')({ playbook: 'alpha', goal: 'g-1' }),
    ).toBe('http://127.0.0.1:5575/studio/?server=http%3A%2F%2F127.0.0.1%3A5575&src=agent&playbook=alpha&goal=g-1');
  });

  it('makes none where the server knows no address Studio can reach it at', () => {
    expect(goalLinksOnNode(studio, () => 'http://0.0.0.0:5555')(place)).toBeUndefined();
  });

  it('reads the address when the link is made, after the server listens', () => {
    let origin = 'http://0.0.0.0:0';
    const linkOf = goalLinksOnNode(studio, () => origin);
    const before = linkOf(place);
    origin = 'http://localhost:5575';

    expect([before, linkOf(place)?.startsWith('https://studio.example/?server=http%3A%2F%2Flocalhost%3A5575')]).toEqual(
      [undefined, true],
    );
  });
});
