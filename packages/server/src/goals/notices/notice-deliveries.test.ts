import { movedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { appendedIn, passedRun } from '../../testing/goals/notice-facts.ts';
import { playbookToldBy, servingGoalNotices, type NoticeServer } from '../../testing/goals/notice-servers.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { until } from '../../testing/waiting/until.ts';

const GapsSchema = Schema.Struct({
  goals: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      gaps: Schema.Array(Schema.Struct({ kind: Schema.String, detail: Schema.String })),
    }),
  ),
});

const NoticesSchema = Schema.Struct({
  goals: Schema.Array(
    Schema.Struct({
      assessments: Schema.Struct({
        current: Schema.NullOr(
          Schema.Struct({
            notices: Schema.Array(
              Schema.Struct({
                change: Schema.String,
                run: Schema.String,
                delivered: Schema.optionalKey(Schema.Boolean),
              }),
            ),
          }),
        ),
      }),
    }),
  ),
});

const HistorySchema = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      data: Schema.Struct({ input: Schema.optionalKey(Schema.Struct({ link: Schema.optionalKey(Schema.String) })) }),
    }),
  ),
});

const hour = 3_600_000;

async function noticesReadOf(served: NoticeServer) {
  const read = Schema.decodeUnknownSync(NoticesSchema)((await served.server.call('GET', `${alpha}/goals`)).body);
  return read.goals.flatMap(({ assessments }) => assessments.current?.notices ?? []);
}

async function noticeGapsOf(
  served: NoticeServer,
): Promise<readonly { readonly kind: string; readonly detail: string }[]> {
  const read = Schema.decodeUnknownSync(GapsSchema)((await served.server.call('GET', `${alpha}/goals`)).body);
  return read.goals.flatMap(({ gaps }) => gaps).filter(({ kind }) => kind.startsWith('notice_'));
}

describe('the link in a notice, on a Node server that keeps goals', () => {
  it('opens the goal and its thing in Studio on this runtime, with no request in progress, and reads delivered once sent', async () => {
    const served = await servingGoalNotices();
    await playbookToldBy(served);
    await served.assessed('now', Date.now());
    await until(
      () => served.runs(),
      (runs) => runs.includes(passedRun),
    );
    await served.server.settled(passedRun);
    const history = await served.server.call('GET', `${alpha}/runs/${passedRun}/history`);
    const started = Schema.decodeUnknownSync(HistorySchema)(history.body).events.find(
      ({ type }) => type === 'run_started',
    );

    expect(await noticesReadOf(served)).toEqual([{ change: 'passed', run: passedRun, delivered: true }]);
    expect(started?.data.input?.link).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/studio\/\?server=http%3A%2F%2F127\.0\.0\.1%3A\d+&src=agent&playbook=alpha&goal=paying-customers&per=experiment-7$/u,
    );
  });
});

describe('a notice that was started and not delivered, on a Node server that keeps goals', () => {
  it('reads undelivered and shows as the gap notice_undelivered once its run ends expired, and no fact repeats it', async () => {
    const at = Date.now();
    const clock = movedClock(at);
    const served = await servingGoalNotices({ clock });
    await playbookToldBy(served);
    await served.chat.close();
    await served.assessed('now', at);
    await until(
      () => served.runs(),
      (runs) => runs.includes(passedRun),
    );
    clock.moveTo(at + 5 * hour);
    const settled = await served.server.settled(passedRun);
    const gaps = await until(
      () => noticeGapsOf(served),
      (found) => found.length > 0,
    );

    expect(settled).toMatchObject({ status: 'rejected' });
    expect(await noticesReadOf(served)).toEqual([{ change: 'passed', run: passedRun, delivered: false }]);
    expect(gaps.map(({ kind }) => kind)).toEqual(['notice_undelivered']);
    expect(gaps[0]?.detail).toMatch(
      /^The message saying the goal paying-customers passed was not delivered: its run was rejected/u,
    );
  });
});

describe('the most notices a playbook sends in a UTC day, on a Node server that keeps goals', () => {
  it('refuses the notice past 200 starts of the day for good, starts nothing, and says so in the gap', async () => {
    const at = Date.now();
    const served = await servingGoalNotices();
    await playbookToldBy(served);
    const runtime = (await served.starting()).runtime;
    await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        appendedIn(runtime, `goal-summaries/goal-${String(index)}`, {
          type: 'goal_summary_started',
          data: { due: new Date(at).toISOString(), window: {}, run: `run-${String(index)}` },
          at,
        }),
      ),
    );
    await served.assessed('now', at);
    const gaps = await until(
      () => noticeGapsOf(served),
      (found) => found.length > 0,
    );

    expect(gaps.map(({ kind }) => kind)).toEqual(['notice_not_started']);
    expect(gaps[0]?.detail).toContain('reached its limit of 200 messages and summaries on');
    expect(await served.runs()).toEqual([]);
    expect(served.chat.chat.posted()).toEqual([]);
  });
});
