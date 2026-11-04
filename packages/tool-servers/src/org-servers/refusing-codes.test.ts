import { Effect } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { fakeConnections, refusedWords } from '../testing/fake-connections.ts';
import { patientTiming } from '../testing/index.ts';
import { describedAccess } from '../testing/reporting-access.ts';
import { fakeApiKey, serveFakeApi } from '../testing/served-fakes.ts';

const alpha = { org: 'acme', playbook: 'alpha' };

const search = { ...alpha, reference: { server: 'graph', tool: 'search' }, input: { query: 'acme' }, meta: {} };

describe('a connection of an HTTP API that answers a code its entry names as a refused key', () => {
  it('tells its source what the API answered, and the call fails in the words the source recorded', async () => {
    const fake = await serveFakeApi({ key: fakeApiKey });
    onTestFinished(fake.close);
    const connections = fakeConnections();
    connections.connect('acme', {
      id: 'graph-id',
      name: 'graph',
      entry: {
        document: fake.documentUrl,
        security: { apiKeyAuth: '${GRAPH_API_KEY}' },
        failure_codes: { succeeded: '/ok', code: '/error', key_refused: ['invalid_auth'] },
      },
      environment: { GRAPH_API_KEY: fakeApiKey },
    });
    const { access } = await describedAccess({}, { timing: patientTiming, connections });
    onTestFinished(access.close);
    fake.answerNextWith({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":false,"error":"invalid_auth"}',
    });

    const called = await Effect.runPromise(Effect.flatMap(access.preparedCall(search), (prepared) => prepared.called));
    const refused = refusedWords('graph', 'The tool server answered invalid_auth');

    expect(called).toMatchObject({ kind: 'answered', detail: refused });
    expect([connections.refusalsTold(), await Effect.runPromise(access.listServers(alpha))]).toMatchObject([
      ['graph-id'],
      [{ name: 'graph', because: 'connection_broken', unavailable: refused }],
    ]);
  });
});
