import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { DefinitionInvalid } from '../failure/definition-invalid.ts';
import { ModelNotAllowed } from '../failure/model-not-allowed.ts';
import { ProviderNotConfigured } from '../failure/provider-not-configured.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { reasoningOf } from '../testing/reasoning-runs.ts';
import { aGraph, attemptOf, graphAccessTo, stopping, withGraphTools } from '../testing/resumed-attempts.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';

const usage = {
  input: { total: 120, uncached: 120, cache_read: null, cache_write: null },
  output: { total: 40, text: 40, reasoning: null },
  total: 160,
};

function asking(tool: string): ScriptedReply {
  return answers(toolCallsResult([[`graph__${tool}`, { query: 'acme' }]], { usage, duration_ms: 400 }));
}

const record = { usage, duration_ms: 400 };

async function cutOffAfterCalling(tool: string) {
  const fake = await aGraph();
  const first = reasoningOf({ tools: graphAccessTo(fake.url) }, asking(tool), stopping);
  await first.running(withGraphTools);
  return { fake, first, attempt: attemptOf(first.journal.calls()) };
}

const openModelCallEnded = [{ type: 'model_call_failed', number: 2, data: { because: 'interrupted' } }];

describe('a resumed attempt whose tool servers cannot be opened, after a call of a tool that may change something', () => {
  it('is a conflict whose effect is unknown, with the spending of its model calls, its open model call ended', async () => {
    const { fake, first, attempt } = await cutOffAfterCalling('echo');
    await fake.close();
    const again = reasoningOf({ tools: graphAccessTo(fake.url), attempt, content: first.content });

    expect(await again.running(withGraphTools)).toEqual(
      Exit.fail(
        expect.objectContaining({ _tag: 'conflict', kind: 'effect_unknown', because: 'server_failed', record }),
      ),
    );
    expect(again.journal.recorded()).toMatchObject(openModelCallEnded);
  });
});

describe('a resumed attempt whose tool servers cannot be opened, after calls of tools that only read', () => {
  it('is unavailable as unfinished because a server failed, with the spending of its model calls', async () => {
    const { fake, first, attempt } = await cutOffAfterCalling('search');
    await fake.close();
    const again = reasoningOf({ tools: graphAccessTo(fake.url), attempt, content: first.content });

    expect(await again.running(withGraphTools)).toEqual(
      Exit.fail(
        expect.objectContaining({ _tag: 'unavailable', kind: 'tools_unfinished', because: 'server_failed', record }),
      ),
    );
  });
});

const notConfigured = () =>
  Effect.fail(
    new ProviderNotConfigured({
      detail: 'anthropic is not configured. Configured providers: openai',
      provider: 'anthropic',
      configured: ['openai'],
      missing: ['ANTHROPIC_API_KEY'],
    }),
  );

describe('a resumed attempt whose model is no longer offered', () => {
  it('is unfinished once it called a tool, with its spending, and refused as not offered before any', async () => {
    const { fake, first, attempt } = await cutOffAfterCalling('search');
    const tools = graphAccessTo(fake.url);
    const unstarted = reasoningOf({ tools }, stopping);
    await unstarted.running(withGraphTools);
    const afterACall = reasoningOf({ tools, attempt, content: first.content, admit: notConfigured });
    const beforeAny = reasoningOf({
      tools,
      attempt: attemptOf(unstarted.journal.calls()),
      content: unstarted.content,
      admit: notConfigured,
    });

    expect(await afterACall.running(withGraphTools)).toEqual(
      Exit.fail(expect.objectContaining({ kind: 'tools_unfinished', because: 'model_unavailable', record })),
    );
    expect(await beforeAny.running(withGraphTools)).toEqual(
      Exit.fail(expect.objectContaining({ kind: 'model_not_offered', because: 'provider_not_configured' })),
    );
    expect([afterACall.requests(), beforeAny.journal.recorded()]).toMatchObject([
      [],
      [{ type: 'model_call_failed', number: 1, data: { because: 'interrupted' } }],
    ]);
  });
});

const notAllowed = () =>
  Effect.fail(
    new ModelNotAllowed({
      detail: 'anthropic/claude-sonnet-4-5 is not one of the models this server offers',
      provider: 'anthropic',
    }),
  );

const noLongerValid = () =>
  Effect.fail(
    new DefinitionInvalid({
      detail: 'The gateway no longer allows the provider options of the definition',
      provider: null,
      status: null,
      provider_message: null,
      issues: [],
    }),
  );

describe('a resumed attempt refused by its model before its steps, after a call of a tool that may change something', () => {
  it.each([
    ['its model no longer allowed', notAllowed, 'model_unavailable', 'is not one of the models this server offers'],
    [
      'its definition refused',
      noLongerValid,
      'definition_refused',
      'The gateway no longer allows the provider options',
    ],
  ])(
    'is a conflict whose effect is unknown, saying why, with its spending, its open model call ended: %s',
    async (_name, admit, because, said) => {
      const { fake, first, attempt } = await cutOffAfterCalling('echo');
      const again = reasoningOf({ tools: graphAccessTo(fake.url), attempt, content: first.content, admit });
      const detail: unknown = expect.stringContaining(said);

      expect(await again.running(withGraphTools)).toEqual(
        Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'effect_unknown', because, detail, record })),
      );
      expect([again.requests(), again.journal.recorded()]).toMatchObject([[], openModelCallEnded]);
    },
  );
});

describe('a resumed attempt that reaches its steps', () => {
  it('takes the prompt it kept, rendering none again', async () => {
    const { first, attempt, fake } = await cutOffAfterCalling('search');
    const again = reasoningOf(
      { tools: graphAccessTo(fake.url), attempt, content: first.content },
      answers(textResult('Found acme.')),
    );

    expect(await again.running(withGraphTools, { text: 'ignored on resume' })).toMatchObject({
      _tag: 'Success',
      value: { output: 'Found acme.', record: { prompt: { message: 'Summarize acme.' } } },
    });
  });
});
