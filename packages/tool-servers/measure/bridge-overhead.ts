import { Effect } from 'effect';

import { serveFakeApi } from '../src/api-testing/fake-api-server.ts';
import { ignored } from '../src/clients/ignored.ts';
import { apiClient } from '../src/openapi/api-client.ts';
import type { DescribedApiSettings } from '../src/openapi/described-api.ts';
import { describedToolServers } from '../src/openapi/described-servers.ts';
import { readToolServerSettings } from '../src/settings/settings-reading.ts';
import { describedAccess } from '../src/testing/reporting-access.ts';

const key = 'graph-api-key-4f1d9a7c2b';

const callsMeasured = 2000;

const callsToWarm = 300;

const entry = { graph: { security: { apiKeyAuth: '${GRAPH_API_KEY}' }, org: 'acme' } };

interface Measured {
  readonly medianMs: number;
  readonly p95Ms: number;
}

function measuredOf(durations: readonly number[]): Measured {
  const sorted = durations.toSorted((first, second) => first - second);
  const at = (share: number) => Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]);
  return { medianMs: at(0.5), p95Ms: at(0.95) };
}

function durationsOf(times: number, call: () => Promise<unknown>): Promise<readonly number[]> {
  const durations: number[] = [];
  const next = async (): Promise<readonly number[]> => {
    if (durations.length === times) {
      return durations;
    }
    const began = performance.now();
    await call();
    durations.push(performance.now() - began);
    return next();
  };
  return next();
}

function shown({ medianMs, p95Ms }: Measured): string {
  return `median ${medianMs.toFixed(3)} ms, p95 ${p95Ms.toFixed(3)} ms`;
}

const fake = await serveFakeApi({ key });
const written = { graph: { ...entry.graph, document: fake.documentUrl } };
const environment = { TOOL_SERVERS: JSON.stringify(written), GRAPH_API_KEY: key };
const { servers } = await Effect.runPromise(
  readToolServerSettings(environment, { modelProviders: [] }).pipe(
    Effect.flatMap((settings) => describedToolServers(settings, { reportLeftOut: ignored })),
  ),
);
const api = servers.find((server): server is DescribedApiSettings => server.type === 'openapi');
if (api === undefined) {
  throw new Error('The document of the fake API described no API');
}
const client = apiClient(api, {
  fetch: globalThis.fetch,
  tokens: undefined,
  now: Date.now,
});
const { access } = await describedAccess(written, { environment: { GRAPH_API_KEY: key } });

const direct = () =>
  fetch(`${fake.baseUrl}/search?query=acme`, { headers: { 'x-api-key': key, accept: 'application/json' } }).then(
    (response) => response.text(),
  );
const bridged = () =>
  client.call({
    tool: 'search',
    input: { query: 'acme' },
    meta: {},
    signal: new AbortController().signal,
    timeoutMs: 30_000,
  });
const accessed = () =>
  Effect.runPromise(
    access.callOnce({
      org: 'acme',
      playbook: 'alpha',
      reference: { server: 'graph', tool: 'search' },
      input: { query: 'acme' },
      meta: {},
    }),
  );

await durationsOf(callsToWarm, direct);
await durationsOf(callsToWarm, bridged);
await durationsOf(callsToWarm, accessed);
const directly = measuredOf(await durationsOf(callsMeasured, direct));
const throughTheBridge = measuredOf(await durationsOf(callsMeasured, bridged));
const throughTheAccess = measuredOf(await durationsOf(callsMeasured, accessed));

console.log(`${callsMeasured} calls of GET /search on loopback, each measured after ${callsToWarm} to warm up`);
console.log(`a direct fetch:                   ${shown(directly)}`);
console.log(`the bridge's client:              ${shown(throughTheBridge)}`);
console.log(`one call through the tool access: ${shown(throughTheAccess)}`);
console.log(
  `overhead at the median: the bridge ${(throughTheBridge.medianMs - directly.medianMs).toFixed(3)} ms, the tool access ${(throughTheAccess.medianMs - directly.medianMs).toFixed(3)} ms`,
);

await access.close();
await fake.close();
