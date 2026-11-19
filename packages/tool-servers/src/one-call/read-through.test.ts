import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { serverThroughOf } from '../testing/fake-connections.ts';
import { patientTiming } from '../testing/index.ts';
import { closedAfter, oneCallKey, oneCallServer } from '../testing/one-calls.ts';
import { reportingAccess } from '../testing/reporting-access.ts';
import { keptNowhere } from './one-call.ts';

function throughTheFake(url: string, key: string) {
  return serverThroughOf('acme', {
    id: 'graph-id',
    name: 'graph',
    entry: { url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' } },
    environment: { GRAPH_API_KEY: key },
  });
}

describe('one read through a server not kept', () => {
  it('calls a tool that only reads, with no arguments, under the credential the server places', async () => {
    const fake = await oneCallServer();
    const { access } = reportingAccess({}, { timing: patientTiming });
    closedAfter(access.close);
    const read = (tool: string, key: string) =>
      Effect.runPromise(
        access.readOnceThrough(
          { org: 'acme', reference: { server: 'graph', tool }, meta: {} },
          throughTheFake(fake.url, key),
        ),
      );

    const reads = await Promise.all([
      read('profile', oneCallKey),
      read('echo', oneCallKey),
      read('profile', 'graph-api-key-0000000000'),
    ]);

    expect(reads).toMatchObject([
      { kind: 'answered', outcome: 'result' },
      { kind: 'unopened', refused: 'tool_not_read_only' },
      { kind: 'unopened', because: 'connection_broken' },
    ]);
    expect(fake.received()).toEqual([{ tool: 'profile', arguments: {}, meta: {} }]);
  });

  it('keeps no content, so a keeping asked of it is refused', async () => {
    await expect(keptNowhere('{}')).rejects.toThrow(Error);
  });
});
