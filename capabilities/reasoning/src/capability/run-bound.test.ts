import { setTimeout } from 'node:timers/promises';

import { reportingAccess, serveFakeMcp, type FakeMcpServer } from '@on.auto/tool-servers/testing';
import { DateTime, Effect, Fiber } from 'effect';
import { TestClock } from 'effect/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { toolCallsResult } from '../testing/model-results.ts';
import { moment, reasoningOf, runContextWith } from '../testing/reasoning-runs.ts';
import { answers } from '../testing/scripted-language-model.ts';

const apiKey = 'graph-api-key-4f1d9a7c2b';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

async function sleepingGraph(): Promise<FakeMcpServer> {
  const fake = await serveFakeMcp({ bearer: apiKey, hints: { sleep: { idempotentHint: true } } });
  closing.push(fake.close);
  return fake;
}

async function calledOnce(fake: FakeMcpServer): Promise<void> {
  if (fake.received().length > 0) {
    return;
  }
  await setTimeout(5);
  await calledOnce(fake);
}

const source = documentOf('model: anthropic/claude-sonnet-4-5\ntools: [graph/sleep]', 'Wait for acme.');

const pastTheBound = '11 minutes';

const counted = {
  input: { total: 120, uncached: 120, cache_read: null, cache_write: null },
  output: { total: 40, text: 40, reasoning: null },
  total: 160,
};

describe('a run whose bound passes while a call of a tool that may change something is in flight', () => {
  it('gives the call up and is a conflict whose effect is unknown, because of its bound', async () => {
    const fake = await sleepingGraph();
    const { access } = reportingAccess(
      { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
      { environment: { GRAPH_API_KEY: apiKey } },
    );
    closing.push(access.close);
    const asking = toolCallsResult([['graph__sleep', { ms: 5000 }]], { usage: counted });
    const reasoning = reasoningOf({ tools: access }, answers(asking));

    const ran = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(moment)));
        const running = yield* Effect.forkChild(
          Effect.flip(reasoning.prepared(source).run({}, runContextWith(reasoning.journal))),
        );
        yield* Effect.promise(() => calledOnce(fake));
        yield* TestClock.adjust(pastTheBound);
        return yield* Fiber.join(running);
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(ran).toMatchObject({
      _tag: 'conflict',
      kind: 'effect_unknown',
      because: 'run_bound',
      record: { usage: { input: { total: 120 }, output: { total: 40 }, total: 160 } },
    });
    expect(reasoning.journal.recorded().at(-1)).toMatchObject({
      type: 'tool_call_failed',
      data: { because: 'cancelled' },
    });
    expect(reasoning.requests()).toHaveLength(1);
  });
});
