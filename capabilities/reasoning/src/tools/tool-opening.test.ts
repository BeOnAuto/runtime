import { serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/served-fakes';
import { reportingAccess } from '@on.auto/tool-servers/testing';
import { Effect, Exit } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { accessFor } from '../testing/adapter-harness.ts';
import { callingTools } from '../testing/calling-tools.ts';
import { documentOf, issuesIn } from '../testing/definition-documents.ts';
import { textResult } from '../testing/model-results.ts';
import { reasoningAdapter, runContext, reasoningWith, reasoningWithTools } from '../testing/reasoning-runs.ts';
import { answers, scriptedLanguageModel } from '../testing/scripted-language-model.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function graphServer(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  return fake;
}

function accessTo(fake: FakeMcpServer, org = 'acme') {
  const { access } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org } },
    { environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  return access;
}

const naming = (...tools: readonly string[]) =>
  documentOf(`model: anthropic/claude-sonnet-4-5\ntools: [${tools.join(', ')}]`, 'Summarize acme.');

describe('the tools key of a reasoning function', () => {
  it('takes server/tool and server/*, each once', () => {
    expect(issuesIn(naming('graph/search', 'graph/*'))).toEqual([]);
    expect(issuesIn(naming('graph', 'graph/search', 'graph/search'))).toEqual([
      expect.stringMatching(/^Line 3, \/tools\/0: Expected server\/tool, or server\/\* for every tool of a server/u),
      'Line 3, /tools/2: graph/search is listed twice',
    ]);
  });
});

describe('a reasoning function that names tools', () => {
  it('runs with the tools it names, under their model-facing names, and lets their session go', async () => {
    const fake = await graphServer();
    const run = reasoningWithTools(
      accessTo(fake),
      ...callingTools([['graph__search', { query: 'acme' }]], answers(textResult('Acme has 2 rows.'))),
    );

    const ran = await run.running(naming('graph/search'));

    expect(ran).toMatchObject({ _tag: 'Success', value: { output: 'Acme has 2 rows.' } });
    expect(run.requests()[0]?.tools).toMatchObject([{ name: 'graph__search' }]);
    expect(run.journal.recorded().map(({ type }) => type)).toEqual([
      'model_call_started',
      'model_call_answered',
      'tool_call_started',
      'tool_call_answered',
      'model_call_started',
      'model_call_answered',
    ]);
    expect(fake.received()).toEqual([
      { tool: 'search', arguments: { query: 'acme' }, meta: { 'auto.on/run_id': runContext().id } },
    ]);
    expect(fake.endedSessions()).toBe(1);
  });

  it('says it may change something outside when tool servers are configured', async () => {
    const run = reasoningWithTools(accessTo(await graphServer()));

    expect(run.capability.mayChangeOutside).toBe(true);
    expect(reasoningWith().capability.mayChangeOutside).toBe(false);
  });
});

describe('the reading of a reasoning function that names tools', () => {
  it('is bounded by the input tokens the operator allows and by the window the catalog gives its model', async () => {
    const asked: string[] = [];
    const scripted = scriptedLanguageModel(
      ...callingTools([['graph__search', { query: 'acme' }]], answers(textResult('Acme has 2 rows.'))),
    );
    const capability = reasoningAdapter({
      languageModel: scripted.languageModel,
      tools: accessTo(await graphServer()),
      reading: {
        mostInputTokens: 500_000,
        contextWindowOf: (model) => {
          asked.push(model);
          return Effect.succeed(200_000);
        },
      },
    });

    await Effect.runPromise(Effect.runSync(capability.prepare(naming('graph/search'))).run({}, runContext()));

    expect(asked).toEqual(['anthropic/claude-sonnet-4-5']);
    expect(scripted.requests()).toHaveLength(2);
  });
});

describe('a tool a reasoning function names that is not offered', () => {
  it('rejects the run as unavailable when no server of that name is configured for its playbook', async () => {
    const run = reasoningWithTools(accessTo(await graphServer(), 'globex'));

    expect(await run.running(naming('graph/search'))).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'unavailable',
          kind: 'tool_not_offered',
          because: 'tool_server_not_configured',
        }),
      ),
    );
  });

  it('rejects the run as unavailable when no tool server is configured at all', async () => {
    expect(await reasoningWith().running(naming('graph/search', 'crm/find'))).toEqual(
      Exit.fail(
        expect.objectContaining({
          kind: 'tool_not_offered',
          because: 'tool_server_not_configured',
          detail: 'No tool server named graph or crm is configured for this playbook',
        }),
      ),
    );
  });

  it('rejects the run as unavailable when its server cannot be used', async () => {
    const fake = await serveFakeMcp();
    await fake.close();
    const run = reasoningWithTools(accessTo(fake));

    expect(await run.running(naming('graph/search'))).toEqual(
      Exit.fail(expect.objectContaining({ kind: 'tool_server_failed', because: 'unreachable' })),
    );
  });
});

describe('a reasoning function with tools whose model is not offered', () => {
  it('is rejected before its tools are opened, so it reaches no server and starts no process', async () => {
    const fake = await graphServer();
    const { languageModel } = await accessFor({ OPENAI_API_KEY: 'k' }, {});
    const capability = reasoningAdapter({
      languageModel,
      offered: { providers: ['openai'], aliases: [] },
      tools: accessTo(fake),
    });
    const prepared = Effect.runSync(capability.prepare(naming('graph/search')));

    expect(await Effect.runPromiseExit(prepared.run({}, runContext()))).toEqual(
      Exit.fail(expect.objectContaining({ kind: 'model_not_offered', because: 'provider_not_configured' })),
    );
    expect(fake.seen()).toEqual([]);
  });
});
