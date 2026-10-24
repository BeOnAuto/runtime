import { getEventListeners } from 'node:events';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { controlledSignals, reportingAccess, toolRun } from '../testing/index.ts';
import { fakeApiKey, openFakeToolRun, serveFakeMcp } from '../testing/served-fakes.ts';
import { until } from '../testing/until.ts';
import type { CallJournal } from './recorded-calls.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function runWith(tools: readonly string[]) {
  const run = await openFakeToolRun(tools);
  closing.push(run.close);
  return run;
}

describe('a run that has ended', () => {
  it('sends no call once the run has ended', async () => {
    const { call, fake, journal } = await runWith(['search']);
    const signals = controlledSignals();

    signals.end();

    expect(await call('search', { query: 'late' }, signals)).toEqual({
      text: 'The run has ended, so this call was not sent.',
      isError: true,
      outcome: 'not_sent',
      resultBytes: null,
      durationMs: 0,
      serverRequestId: null,
    });
    expect(fake.received()).toEqual([]);
    expect(journal.facts()).toEqual([]);
  });

  it('never sends a call whose start could not be recorded', async () => {
    const { call, fake, journal } = await runWith(['search']);

    journal.refuseStartsFromNowOn();

    expect(await call('search', { query: 'unrecorded' })).toMatchObject({
      text: 'This call could not be recorded on its run, so it was not sent; answer without it.',
      isError: true,
      outcome: 'not_sent',
    });
    expect(fake.received()).toEqual([]);
  });
});

describe('a run that ends while it calls', () => {
  it('records a call in flight when the run ends as cancelled', async () => {
    const { call, fake, journal } = await runWith(['sleep']);
    const signals = controlledSignals();

    const replied = call('sleep', { ms: 5000 }, signals);
    await until(() => fake.received().length === 1);
    signals.end();

    expect(await replied).toMatchObject({
      text: 'The tool server graph failed: The call was cancelled because the run ended',
      isError: true,
    });
    expect(journal.facts().at(-1)).toMatchObject({ type: 'tool_call_failed', data: { because: 'cancelled' } });
  });

  it('leaves a call in flight when the run is cancelled with a start and no answer', async () => {
    const { call, fake, journal } = await runWith(['sleep']);
    const signals = controlledSignals();

    const replied = call('sleep', { ms: 5000 }, signals);
    await until(() => fake.received().length === 1);
    signals.cancel();
    await replied;

    expect(journal.facts().map(({ type }) => type)).toEqual(['tool_call_started']);
  });

  it('stops waiting out a 429 when the run ends', async () => {
    const { call, fake, journal } = await runWith(['search']);
    const signals = controlledSignals();

    fake.answerNextOf('tools/call', 429, 1, { 'retry-after': '5' });
    const replied = call('search', { query: 'waiting' }, signals);
    await until(() => getEventListeners(signals.signal, 'abort').length > 0);
    signals.end();

    expect(await replied).toMatchObject({ isError: true });
    expect(journal.facts().at(-1)).toMatchObject({ type: 'tool_call_failed', data: { because: 'cancelled' } });
    expect(fake.received()).toEqual([]);
  });
});

async function runCancelledOnRecording() {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const { access } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(access.close);
  const signals = controlledSignals();
  const facts: string[] = [];
  const journal: CallJournal = {
    started: () =>
      Effect.sync(() => {
        facts.push('tool_call_started');
        signals.cancel();
        return 1;
      }),
    ended: (_number, fact) =>
      Effect.sync(() => {
        facts.push(fact.type);
        return true;
      }),
  };
  const tools = await Effect.runPromise(access.open(toolRun(journal), [{ server: 'graph', tool: 'search' }]));
  closing.push(tools.close);
  return { fake, signals, facts, search: tools.offered[0] };
}

describe('a run cancelled between recording the start of a call and sending it', () => {
  it('records the call started and never answered, and its server sees no call', async () => {
    const { fake, signals, facts, search } = await runCancelledOnRecording();

    const replied = await search?.call({ callId: 'call-1', input: { query: 'late' } }, signals);

    expect(replied).toMatchObject({
      text: 'The tool server graph failed: The call was cancelled because the run ended',
      isError: true,
    });
    expect(facts).toEqual(['tool_call_started']);
    expect(fake.received()).toEqual([]);
    expect(fake.seen().map(({ rpc }) => rpc)).not.toContain('tools/call');
  });
});
