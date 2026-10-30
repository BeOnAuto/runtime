import { reportingAccess, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';

import { recordingFetch, type Responder } from '../provider-testing/recording-fetch.ts';
import type { ModelAccessOptions } from '../providers/model-access-options.ts';
import type { Environment } from '../settings/setting-values.ts';
import { accessFor } from './adapter-harness.ts';
import { reasoningAdapter, runContext, type Run } from './reasoning-runs.ts';

export const fakeGraphKey = 'graph-api-key-4f1d9a7c2b';

export interface ProviderSetup {
  readonly provider: string;
  readonly environment: Environment;
  readonly options?: Omit<ModelAccessOptions, 'fetch'>;
}

export interface ProviderRunning {
  readonly setup: ProviderSetup;
  readonly respond: Responder;
  readonly fake: FakeMcpServer;
  readonly source: string;
  readonly reading?: { readonly mostInputTokens: number; readonly contextWindow?: number };
}

export interface ProviderRun {
  readonly exit: Run;
  readonly bodies: readonly string[];
}

export async function providerRun({ setup, respond, fake, source, reading }: ProviderRunning): Promise<ProviderRun> {
  const recording = recordingFetch(respond);
  const { languageModel } = await accessFor(setup.environment, { ...setup.options, fetch: recording.fetch });
  const { access } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: fakeGraphKey } },
  );
  const capability = reasoningAdapter({
    languageModel,
    offered: { providers: [setup.provider], aliases: [] },
    tools: access,
    ...(reading === undefined
      ? {}
      : {
          reading: {
            mostInputTokens: reading.mostInputTokens,
            contextWindowOf: () => Effect.succeed(reading.contextWindow),
          },
        }),
  });
  const prepared = Effect.runSync(capability.prepare(source));
  const exit = await Effect.runPromiseExit(prepared.run({}, runContext()));
  await access.close();
  return { exit, bodies: recording.requests().map(({ body }) => JSON.stringify(body)) };
}
