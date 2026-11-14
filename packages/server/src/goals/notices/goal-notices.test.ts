import { StartRefused } from '@on.auto/workflow-host';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Effect, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { assessment, noticeHeadline, passedRun } from '../../testing/goals/notice-facts.ts';
import {
  playbookToldBy,
  servingGoalNotices,
  type NoticeServer,
  type StartOver,
} from '../../testing/goals/notice-servers.ts';
import { temporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { plainGoalId } from '../../testing/settings/goals-kept.ts';
import { until } from '../../testing/waiting/until.ts';

const GapsSchema = Schema.Struct({
  goals: Schema.Array(Schema.Struct({ id: Schema.String, gaps: Schema.Array(Schema.Struct({ kind: Schema.String })) })),
});

const minute = 60_000;

const assessmentStream = `assessments/${assessment}`;

const startedFacts = ['goal_assessment_opened', 'goal_assessed', 'goal_notice_started'];

function aWhile(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function noticeStartedIn(served: NoticeServer): Promise<readonly string[]> {
  return until(
    () => served.factsOf(assessmentStream),
    (facts) => facts.includes('goal_notice_started'),
  );
}

async function noticeGapsOf(served: NoticeServer): Promise<readonly string[]> {
  const read = Schema.decodeUnknownSync(GapsSchema)((await served.server.call('GET', `${alpha}/goals`)).body);
  return read.goals.flatMap(({ gaps }) => gaps.map(({ kind }) => kind)).filter((kind) => kind.startsWith('notice_'));
}

describe('a verdict the owner asked to hear of now, on a Node server that keeps goals', () => {
  it('leads to exactly one delivered notice, with the words of the goal, which a second start does not repeat', async () => {
    const served = await servingGoalNotices();
    await playbookToldBy(served);
    await served.assessed('now', Date.now());

    const posted = await until(
      () => served.chat.chat.posted(),
      (messages) => messages.length > 0,
    );
    const settled = await served.server.settled(passedRun);
    const facts = await noticeStartedIn(served);
    const { start } = await served.starting();
    await Effect.runPromise(
      start({
        org: 'acme',
        playbook: 'alpha',
        type: 'interaction',
        name: 'tell-owner',
        runId: passedRun,
        input: { headline: 'Again' },
        trigger: { kind: 'goal', reference: `goals/paying-customers/assessments/${assessment}` },
      }),
    );
    await aWhile(1500);

    expect(posted).toMatchObject([{ text: noticeHeadline }]);
    expect(settled).toMatchObject({ status: 'succeeded' });
    expect(facts).toEqual(startedFacts);
    expect(served.chat.chat.posted()).toHaveLength(1);
    expect(await served.runs()).toEqual([passedRun]);
    expect(await served.factsOf(assessmentStream)).toEqual(startedFacts);
  });
});

describe('a verdict told now when the server stops before its notice starts', () => {
  it('loses nothing to a stop between the verdict and the start: the due column starts it when the server is back', async () => {
    const ledger = temporaryLedger();
    onTestFinished(ledger.remove);
    const before = await servingGoalNotices({ ledger, notices: false });
    await playbookToldBy(before);
    await before.assessed('now', Date.now());
    await aWhile(500);
    const runsBefore = await before.runs();
    await before.server.stop();
    const after = await servingGoalNotices({ ledger });

    expect(runsBefore).toEqual([]);
    expect(await noticeStartedIn(after)).toEqual(startedFacts);
    expect(await after.server.settled(passedRun)).toMatchObject({ status: 'succeeded' });
    expect(await after.runs()).toEqual([passedRun]);
  });
});

describe('the notices of verdicts on a Node server that keeps goals, as work it performs', () => {
  it('starts nothing for a verdict told quietly or in a summary, and never spins', async () => {
    const served = await servingGoalNotices();
    await playbookToldBy(served);
    await served.assessed('summary', Date.now());
    await served.assessed('quiet', Date.now(), plainGoalId);
    await aWhile(2500);

    expect(await served.runs()).toEqual([]);
    expect(served.performs()).toBe(0);
    expect(served.chat.chat.posted()).toEqual([]);
  });

  it('performs a started notice a few times at most, never in a loop', async () => {
    const served = await servingGoalNotices();
    await playbookToldBy(served);
    await served.assessed('now', Date.now());
    await noticeStartedIn(served);
    const performed = served.performs();
    await aWhile(2500);

    expect(performed).toBe(1);
    expect(served.performs()).toBe(performed);
  });
});

const unavailable: StartOver = () => () => Effect.fail(new StartRefused({ detail: 'The runtime is busy' }));

describe('a notice the runtime cannot start, on a Node server that keeps goals', () => {
  it('is tried again with backoff, and is refused after six tries and shows as a gap', async () => {
    const at = Date.now();
    const clock = movedClock(at);
    const served = await servingGoalNotices({ clock, startOver: unavailable });
    await playbookToldBy(served);
    await served.assessed('now', at);
    const triedAt = [1, 3, 7, 15, 31].map((minutes) => at + minutes * minute + 1000);
    await triedAt.reduce(async (before, moment, index) => {
      await before;
      await until(
        () => served.performs(),
        (performs) => performs > index,
      );
      clock.moveTo(moment);
    }, Promise.resolve());
    await until(
      () => served.performs(),
      (performs) => performs >= 6,
    );
    clock.moveTo(at + 3 * 60 * minute);
    await aWhile(1500);
    const gaps = await until(
      () => noticeGapsOf(served),
      (kinds) => kinds.includes('notice_not_started'),
    );

    expect(served.performs()).toBe(6);
    expect(gaps).toEqual(['notice_not_started']);
    expect(await served.factsOf(assessmentStream)).toEqual([
      'goal_assessment_opened',
      'goal_assessed',
      ...Array.from({ length: 6 }, () => 'goal_notice_refused'),
    ]);
    expect(await served.runs()).toEqual([]);
  });
});

describe('a notice through a paused function, on a Node server that keeps goals', () => {
  it('is refused at once and shows as a gap, and nothing is sent', async () => {
    const served = await servingGoalNotices();
    await playbookToldBy(served);
    const paused = await served.server.call('POST', `${alpha}/definitions/interaction/tell-owner/pause`, { body: {} });
    await served.assessed('now', Date.now());
    const gaps = await until(
      () => noticeGapsOf(served),
      (kinds) => kinds.length > 0,
    );
    await aWhile(1500);

    expect(paused.status).toBe(200);
    expect(gaps).toEqual(['notice_not_started']);
    expect(await served.factsOf(assessmentStream)).toEqual([
      'goal_assessment_opened',
      'goal_assessed',
      'goal_notice_refused',
    ]);
    expect(served.performs()).toBe(1);
    expect(served.chat.chat.posted()).toEqual([]);
  });
});
