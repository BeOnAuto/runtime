import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { RateLimited } from '../failure/rate-limited.ts';
import { noLongerOffered } from '../steps/asked-calls.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { firstAttempt, reasoningOf } from '../testing/reasoning-runs.ts';
import {
  aGraph,
  attemptOf,
  graphAccessTo,
  recordedBy,
  stopping,
  upToTheFirst,
  withGraphTools,
  withoutTools,
} from '../testing/resumed-attempts.ts';
import { answers, type ScriptedReply } from '../testing/scripted-language-model.ts';

const limited: ScriptedReply = () =>
  Effect.fail(
    new RateLimited({ detail: 'anthropic is limiting the rate', provider: 'anthropic', retry_after_ms: 2000 }),
  );

const echoing = answers(toolCallsResult([['graph__echo', { said: 'acme' }]]));

describe('a run that goes on after a call of a tool that may change something was never answered', () => {
  it('is a conflict whose effect is unknown, because the outcome of that call is not known', async () => {
    const tools = graphAccessTo((await aGraph()).url);
    const { calls, first } = await recordedBy(withGraphTools, { tools }, echoing, answers(textResult('Echoed.')));
    const again = reasoningOf({
      tools,
      attempt: attemptOf(upToTheFirst(calls, 'tool_call_started')),
      content: first.content,
    });

    expect(await again.running(withGraphTools)).toEqual(
      Exit.fail(
        expect.objectContaining({
          _tag: 'conflict',
          kind: 'effect_unknown',
          because: 'call_outcome_unknown',
          detail:
            'The server restarted while the run called a tool that may change something, so whether that call did is not known, after the run called the echo tool of graph',
        }),
      ),
    );
  });
});

describe('a run that goes on after its server stopped offering a tool the model asked for', () => {
  it('tells the model the tool is no longer offered and goes on to its answer, sending nothing', async () => {
    const fake = await aGraph();
    const { calls, first } = await recordedBy(
      withGraphTools,
      { tools: graphAccessTo(fake.url) },
      echoing,
      answers(textResult('Echoed.')),
    );
    const again = reasoningOf(
      {
        tools: graphAccessTo(fake.url, { allowed: ['search'] }),
        attempt: attemptOf(upToTheFirst(calls, 'model_call_answered')),
        content: first.content,
      },
      answers(textResult('Searched instead.')),
    );

    expect(await again.running(withGraphTools)).toMatchObject({
      _tag: 'Success',
      value: { output: 'Searched instead.' },
    });
    expect(JSON.stringify(again.requests()[0]?.conversation)).toContain(noLongerOffered('graph__echo'));
    expect(fake.received().filter(({ tool }) => tool === 'echo')).toHaveLength(1);
  });
});

describe('a run that ended without a final result, asked for again under its id', () => {
  it('runs again, numbering its model calls after those of the attempt before', async () => {
    const { calls } = await recordedBy(withoutTools, {}, limited);
    const again = reasoningOf(
      { attempt: { ...firstAttempt, modelCallsBefore: 1 } },
      answers(textResult('Profits rose.')),
    );

    expect(await again.running(withoutTools)).toMatchObject({ _tag: 'Success', value: { output: 'Profits rose.' } });
    expect([calls.length, again.journal.recorded()]).toMatchObject([
      2,
      [
        { type: 'model_call_started', number: 2 },
        { type: 'model_call_answered', number: 2 },
      ],
    ]);
  });
});

describe('a run cut off in two attempts, performed a third time', () => {
  it('numbers each model call it makes again after those of the attempts before it', async () => {
    const { calls, first } = await recordedBy(withoutTools, {}, stopping);
    const second = reasoningOf({ attempt: attemptOf(calls), content: first.content }, stopping);
    await second.running(withoutTools);
    const third = reasoningOf(
      { attempt: attemptOf([...calls, ...second.journal.calls()]), content: first.content },
      answers(textResult('Profits rose.')),
    );

    expect(await third.running(withoutTools)).toMatchObject({ _tag: 'Success', value: { output: 'Profits rose.' } });
    expect(
      [second, third].map(({ journal }) => journal.recorded().map(({ type, number }) => `${type} ${number}`)),
    ).toEqual([
      ['model_call_failed 1', 'model_call_started 2'],
      ['model_call_failed 2', 'model_call_started 3', 'model_call_answered 3'],
    ]);
  });
});

describe('a run that goes on from a model call that failed', () => {
  it('ends with the rejection the attempt that recorded the failure ended with, making no call', async () => {
    const { calls, ran, first } = await recordedBy(withoutTools, {}, limited);
    const again = reasoningOf({ attempt: attemptOf(calls), content: first.content });

    expect(await again.running(withoutTools)).toEqual(ran);
    expect(again.requests()).toEqual([]);
  });
});
