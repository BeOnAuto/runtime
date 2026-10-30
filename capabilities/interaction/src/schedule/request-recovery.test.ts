import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { askedRunId, askedThroughChat, noTools } from '../testing/index.ts';
import { requestsDue } from './due-requests.ts';
import { recordedCall } from './request-ledger.ts';

const minute = 60_000;

const address = { org: 'acme', playbook: 'alpha', id: askedRunId };

describe('an attempt the server stopped in', () => {
  it('ends as lost once its bound passed, and the next attempt follows on the schedule', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    await Effect.runPromise(
      recordedCall(
        playbook.record,
        address,
        { type: 'delivery_started', data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' } },
        { causationId: null, correlationId: askedRunId },
      ),
    );

    const whileInFlight = await playbook.performDue(askedAt + 30_000);
    await playbook.performDue(Date.now() + minute + 1000);
    const lost = await playbook.firstOpen();
    await playbook.performDue(Date.now() + 2 * minute + 2000);

    expect(whileInFlight).toBe(0);
    expect(lost).toMatchObject({ attempts: 1, standing: 'retrying' });
    expect(tools.calls()).toHaveLength(1);
    expect(await playbook.firstOpen()).toMatchObject({ attempts: 2, standing: 'delivered' });
  });
});

describe('an attempt two hosts make at once', () => {
  it('is made by the host whose start is recorded first, and the other sends nothing', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    const items = await playbook.dueItems(askedAt);

    await playbook.performAll([...items, ...items], askedAt);

    expect(tools.calls()).toHaveLength(1);
  });
});

describe('a due request whose run has ended, or whose tool is no longer allowed', () => {
  it('sends nothing for a run answered since it was read as due', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    const items = await playbook.dueItems(askedAt);
    await playbook.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'approve' } });

    await playbook.performAll(items, askedAt);

    expect(tools.calls()).toEqual([]);
  });

  it('fails each attempt as a tool no longer offered, and the request stays open, to be answered through the inbox', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    tools.disallow('post_message');

    await playbook.performDue(askedAt);
    const open = await playbook.firstOpen();
    const nextDue = await Effect.runPromise(playbook.due.nextDueAt(askedAt));
    const answered = await playbook.call(answerInteraction, { run_id: askedRunId, answer: { choice: 'approve' } });

    expect(tools.calls()).toEqual([]);
    expect(open).toMatchObject({ attempts: 1, standing: 'retrying' });
    expect(nextDue).toBeGreaterThan(askedAt + minute - 1000);
    expect(answered).toMatchObject({ status: 'succeeded', output: { answer: { choice: 'approve' } } });
  });
});

describe('a request whose tool server is gone since it asked', () => {
  it('fails its attempt as a tool no longer offered, and two hosts that try record the failure once', async () => {
    const { playbook, askedAt } = await askedThroughChat();
    const withoutServers = requestsDue({ ledger: playbook.ledger.service, tools: noTools, record: playbook.record });
    const items = await playbook.dueItems(askedAt, withoutServers);

    await playbook.performAll([...items, ...items], askedAt);

    expect(await playbook.firstOpen()).toMatchObject({ attempts: 1, standing: 'retrying' });
  });
});

describe('a request whose run is asked to cancel', () => {
  it('sends nothing more, even for an attempt read as due before the cancel was asked', async () => {
    const { playbook, tools, askedAt } = await askedThroughChat();
    const items = await playbook.dueItems(askedAt);

    const asked = await playbook.cancel(askedRunId);
    await playbook.performAll(items, askedAt);
    const performed = await playbook.performDue(Date.now() + 10 * minute);

    expect([asked.status, performed, tools.calls()]).toEqual(['succeeded', 0, []]);
    expect(await playbook.firstOpen()).toMatchObject({ standing: 'cancelling', attempts: 0 });
  });
});
