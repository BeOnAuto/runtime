import { makeModelAccess } from '@on.auto/reasoning';
import { anthropicMessage, anthropicToolCall, jsonResponse, recordingFetch } from '@on.auto/reasoning/testing';
import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { onTestFinished } from 'vitest';

import { compositionRootWith } from '../../composition/composition-root.ts';
import { startServer } from '../../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../records/temporary-ledger.ts';
import { receivingOtlp, type OtlpReceiver } from '../telemetry/otlp-receiver.ts';
import { request, type RequestOptions, type TestResponse } from './http-client.ts';
import { alpha, loopbackSettingsOver } from './reasoning-server.ts';

export interface TracedServer {
  readonly receiver: OtlpReceiver;
  readonly tools: FakeMcpServer;
  readonly call: (method: string, path: string, options?: RequestOptions) => Promise<TestResponse>;
  readonly stop: () => Promise<void>;
}

const toolKey = 'graph-api-key-4f1d9a7c2b';

export const promptText = 'Summarize the accounts of acme.';

const searching = ['---', 'model: anthropic/claude-sonnet-4-5', 'tools: [graph/search]', '---', promptText].join('\n');

function answerOf(asked: unknown): object {
  return JSON.stringify(asked).includes('"tool_result"')
    ? anthropicMessage('Acme has 2.')
    : anthropicToolCall('graph__search', { query: 'acme' });
}

const provider = (): ReturnType<typeof recordingFetch> =>
  recordingFetch(({ url, body }) =>
    jsonResponse(url.endsWith('/messages') ? answerOf(body) : { data: [], has_more: false }),
  );

export async function servingTraced(environment: Readonly<Record<string, string>> = {}): Promise<TracedServer> {
  const receiver = await receivingOtlp();
  onTestFinished(receiver.close);
  const tools = await serveFakeMcp({ bearer: toolKey });
  onTestFinished(tools.close);
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  const { fetch } = provider();
  const server = await startServer(
    {
      ...loopbackSettingsOver(ledger),
      ANTHROPIC_API_KEY: 'k',
      GRAPH_API_KEY: toolKey,
      TOOL_SERVERS: JSON.stringify({
        graph: { url: tools.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' },
      }),
      OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      ...environment,
    },
    compositionRootWith((settings, proxy, telemetry) => makeModelAccess(settings, { proxy, fetch, telemetry })),
  );
  const call = (method: string, path: string, options?: RequestOptions) => request(server.port, method, path, options);
  await call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await call('POST', `${alpha}/definitions/reasoning`, { body: { name: 'searching', source: searching } });
  return { receiver, tools, call, stop: () => server.stop() };
}
