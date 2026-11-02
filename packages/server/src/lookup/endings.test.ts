import { describe, expect, it } from 'vitest';

import { endedFor, mayChange, problems } from '../testing/interaction-servers/call-endings.ts';
import { calling, lookingUp, problemWith, systemRunId } from '../testing/interaction-servers/system-calls.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { afterSending, beforeSending, unreadable } from './ending-rows.ts';

const anotherRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

describe('a run of a lookup function that ends before anything is sent, over HTTP', () => {
  it.each(beforeSending)('ends as the table says after %s', async (_case, row, ending) => {
    expect(await endedFor('lookup', row)).toEqual(ending);
  });
});

describe('a run of a lookup function that ends after its call was sent, over HTTP', () => {
  it.each(afterSending)('ends as the table says after %s', async (_case, row, ending) => {
    expect(await endedFor('lookup', row)).toEqual(ending);
  });
});

describe('a run of a lookup function that cannot use what the tool answered, over HTTP', () => {
  it.each(unreadable)('ends as the table says after %s', async (_case, row, ending) => {
    expect(await endedFor('lookup', row)).toEqual(ending);
  });
});

describe('a run of a lookup function whose tool its server has marked acts since it was saved', () => {
  it('records no call in its history and sends nothing', async () => {
    const server = await lookingUp();
    await server.define('thread-replies');
    server.fake.annotateTool('thread', mayChange);

    const ran = await server.runCall('thread-replies');
    const history = await server.history(systemRunId);

    expect(ran).toMatchObject({ status: 503, body: { reason: 'unavailable', kind: 'tool_not_read_only' } });
    expect(history.map(({ type }) => type)).toEqual(['run_started', 'run_rejected']);
    expect(server.fake.received()).toEqual([]);
  });
});

describe('a run of a lookup function, run again under its id, over HTTP', () => {
  it('is tools_called once its call was sent, saying nothing was changed since its tool only reads', async () => {
    const server = await lookingUp();
    await server.define('denying', calling('denied'));

    const sent = [
      await server.runCall('denying', undefined, anotherRunId),
      await server.runCall('denying', undefined, anotherRunId),
    ];

    expect(sent.map(({ status }) => status)).toEqual([503, 409]);
    expect(sent[1]?.body).toEqual(
      problemWith({ type: `${problems}tools_called`, kind: 'tools_called', because: 'only_read' }),
    );
    expect(server.fake.received()).toHaveLength(1);
  });

  it('keeps the wait a 429 asked for past the longest a run waits in its record, and waits out a shorter one', async () => {
    const server = await lookingUp();
    await server.define('asking', calling('search', ['    query: acme']));
    server.fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '20' });

    const limited = await server.runCall('asking');
    server.fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '2' });
    const waited = await server.runCall('asking', undefined, anotherRunId);
    const read = await server.call('GET', `${alpha}/runs/${systemRunId}`);

    expect([limited.status, limited.headers.get('retry-after'), waited.status]).toEqual([503, null, 200]);
    expect(read.body).toMatchObject({
      rejection: { kind: 'tools_unfinished', because: 'server_failed' },
      record: { retry_after_ms: 20_000 },
    });
  });
});
