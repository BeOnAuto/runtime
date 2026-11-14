import { originCounts } from '@on.auto/goals';
import { StartRefused, StartRejected } from '@on.auto/workflow-host';
import { describe, expect, it } from 'vitest';

import { sqliteLedgerDatabase } from '../../database/sqlite-ledger-database.ts';
import { readOnTheLedger, type Opened } from '../../testing/chains/chain-ledger.ts';
import { deliveryRowsOf } from '../../testing/interaction-servers/chat-deliveries.ts';
import { goalTrigger, notice, noticeRunId, servingNotices } from '../../testing/interaction-servers/notice-starts.ts';
import type { TemporaryLedger } from '../../testing/records/temporary-ledger.ts';
import { alpha } from '../../testing/servers/reasoning-server.ts';
import { until } from '../../testing/waiting/until.ts';

const brief = `${alpha}/definitions/interaction/brief-out`;

function openedOn(ledger: TemporaryLedger): Opened {
  return { environment: {}, ledger, database: () => sqliteLedgerDatabase(ledger.fileName) };
}

const otherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

describe('a notification function host code starts by a run id it chose, with a trigger of kind goal', () => {
  it('runs its active version once and delivers through the tool server, and a second start under the id starts nothing', async () => {
    const { server, chat, start, runs } = await servingNotices();

    await start(notice);
    const settled = await server.settled(noticeRunId);
    await start({ ...notice, input: { campaign: 'Autumn', owner: 'ben' } });
    const history = await server.call('GET', `${alpha}/runs/${noticeRunId}/history`);

    expect(settled).toMatchObject({ status: 'succeeded' });
    expect(chat.chat.posted()).toMatchObject([{ channel: '#approvals-ada', text: 'The brief for Spring is out.' }]);
    expect(await deliveryRowsOf(server, noticeRunId)).toMatchObject([
      { type: 'delivery_started' },
      { type: 'delivery_succeeded' },
    ]);
    expect(history.body).toHaveProperty('events.0.type', 'run_started');
    expect(history.body).toHaveProperty('events.0.data.input', notice.input);
    expect(await runs()).toEqual([noticeRunId]);
  });
});

describe('a notification function started again under the id of a run that has ended', () => {
  it('is answered as started, since its run stands and tells its own ending, and records no second start', async () => {
    const { server, chat, start, runs } = await servingNotices();
    await chat.close();

    await start(notice);
    await until(
      () => deliveryRowsOf(server, noticeRunId),
      (rows) => rows.some(({ type }) => type === 'delivery_failed'),
    );
    await server.call('POST', `${alpha}/runs/${noticeRunId}/cancel`, { body: { reason: 'No longer needed' } });
    const ended = await server.settled(noticeRunId);
    await start(notice);
    const history = await server.call('GET', `${alpha}/runs/${noticeRunId}/history`);

    expect(ended).toMatchObject({ status: 'rejected', rejection: { reason: 'cancelled' } });
    expect(JSON.stringify(history.body).match(/"run_started"/gu)).toHaveLength(1);
    expect(await runs()).toEqual([noticeRunId]);
  });
});

describe('a notice run, as the playbook and its meter read it', () => {
  it('is begun by the playbook with its goal trigger and no caller, and its chain counts as no evidence', async () => {
    const { server, start, metered, ledger } = await servingNotices();

    await start(notice);
    await server.settled(noticeRunId);
    const history = await server.call('GET', `${alpha}/runs/${noticeRunId}/history`);
    await server.stop();
    const origin = (await readOnTheLedger(openedOn(ledger), [noticeRunId])).before.origins.get(noticeRunId);

    expect(metered()).toMatchObject([
      {
        run_id: noticeRunId,
        definition_type: 'interaction',
        definition_name: 'brief-out',
        called_by: null,
        trigger: goalTrigger,
        started_by: 'playbook:alpha',
      },
    ]);
    expect(history.body).toHaveProperty('events.0', expect.objectContaining({ type: 'run_started' }));
    expect(history.body).toHaveProperty('events.0.metadata', expect.objectContaining({ by: 'playbook:alpha' }));
    expect(history.body).toHaveProperty('events.0.metadata.trigger', goalTrigger);
    expect(history.body).not.toHaveProperty('events.0.metadata.called_by');
    expect([origin, originCounts('playbook')]).toEqual(['playbook', false]);
  });
});

describe('a notification function that cannot be started', () => {
  it('is rejected as missing, paused or retired, and nothing runs or is posted', async () => {
    const { server, chat, refusalOf, runs } = await servingNotices();

    const missing = await refusalOf({ ...notice, name: 'nobody' });
    await server.call('POST', `${brief}/pause`, { body: {} });
    const paused = await refusalOf(notice);
    await server.call('POST', `${brief}/retire`, { body: {} });
    const retired = await refusalOf(notice);

    expect(missing).toBeInstanceOf(StartRejected);
    expect(paused).toBeInstanceOf(StartRejected);
    expect(retired).toBeInstanceOf(StartRejected);
    expect([missing, paused, retired]).toMatchObject([
      { detail: 'There is no interaction function nobody in this playbook' },
      { kind: 'paused' },
      { kind: 'retired' },
    ]);
    expect([await runs(), chat.chat.posted()]).toEqual([[], []]);
  });

  it('is rejected when it refuses the input, its run ending rejected before anything is delivered', async () => {
    const { server, chat, refusalOf, runs } = await servingNotices();

    const refusing = await refusalOf({ ...notice, runId: otherRunId, input: { campaign: 5 } });

    expect(refusing).toBeInstanceOf(StartRejected);
    expect(refusing).toMatchObject({ kind: 'input_schema' });
    expect([await runs(), chat.chat.posted()]).toEqual([[otherRunId], []]);
    expect(await server.settled(otherRunId)).toMatchObject({
      status: 'rejected',
      rejection: { reason: 'invalid_input' },
    });
    expect(await deliveryRowsOf(server, otherRunId)).toEqual([]);
  });
});

describe('a notification function the runtime cannot admit', () => {
  it('is refused for now, not rejected, while the runtime cannot admit it, and starts once it can', async () => {
    const { server, chat, start, refusalOf, meter, runs } = await servingNotices();
    meter.refuse({ kind: 'meter_unavailable', detail: 'The meter cannot be reached' });

    const unavailable = await refusalOf(notice);
    const before = await runs();
    meter.admitAgain();
    await start(notice);
    await until(
      () => chat.chat.posted(),
      (posted) => posted.length === 1,
    );

    expect(unavailable).toBeInstanceOf(StartRefused);
    expect(before).toEqual([]);
    expect(await server.settled(noticeRunId)).toMatchObject({ status: 'succeeded' });
  });

  it('is rejected for a closed account, which sends nothing', async () => {
    const { chat, refusalOf, meter, runs } = await servingNotices();
    meter.refuse({ kind: 'account_closed', detail: 'The account is closed' });

    const closed = await refusalOf(notice);

    expect(closed).toBeInstanceOf(StartRejected);
    expect(closed).toMatchObject({ kind: 'account_closed' });
    expect([await runs(), chat.chat.posted()]).toEqual([[], []]);
  });
});
