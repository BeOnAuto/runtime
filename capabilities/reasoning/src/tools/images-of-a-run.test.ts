import { keptTextOf } from '@on.auto/content/testing';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { reportingAccess } from '@on.auto/tool-servers/testing';
import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { documentOf } from '../testing/definition-documents.ts';
import { answers, callingTools, textResult } from '../testing/index.ts';
import { reasoningOf, runContext, type Reasoning, type ReasoningRun } from '../testing/reasoning-runs.ts';

type KeepRunImage = NonNullable<Reasoning['images']>;

const apiKey = 'graph-api-key-4f1d9a7c2b';

const alpha = { org: 'acme', playbook: 'alpha' };

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const decodeAnswered = Schema.decodeUnknownSync(
  Schema.Struct({ type: Schema.Literal('tool_call_answered'), data: Schema.Struct({ result_sha256: Schema.String }) }),
);

const someBytes: unknown = expect.any(String);

const photo = documentOf('model: anthropic/claude-sonnet-4-5\ntools: [graph/photo]', 'Look at acme.');

function keeping() {
  const kept: Parameters<KeepRunImage>[0][] = [];
  const keep: KeepRunImage = (image) =>
    Effect.sync(() => {
      kept.push(image);
      return `asset-${kept.length}`;
    });
  return { keep, kept };
}

async function answerOf(run: ReasoningRun, content: Parameters<typeof keptTextOf>[0]): Promise<unknown> {
  const answered = decodeAnswered(run.journal.recorded().find(({ type }) => type === 'tool_call_answered'));
  return JSON.parse(String(await keptTextOf(content, alpha, answered.data.result_sha256)));
}

async function photographed(images?: KeepRunImage) {
  const fake = await serveFakeMcp({ bearer: apiKey });
  closing.push(fake.close);
  const { access, content } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' } },
    { environment: { GRAPH_API_KEY: apiKey } },
  );
  closing.push(access.close);
  const run = reasoningOf(
    { tools: access, ...(images === undefined ? {} : { images }) },
    ...callingTools([['graph__photo', {}]], answers(textResult('A pixel.'))),
  );
  const ran = await run.running(photo);
  return { ran, answer: await answerOf(run, content) };
}

describe('an image a tool answers a run', () => {
  it('is kept as an asset of the run, the answer the run records naming the asset in place of its bytes', async () => {
    const { keep, kept } = keeping();

    const { ran, answer } = await photographed(keep);

    expect(ran).toMatchObject({ _tag: 'Success', value: { output: 'A pixel.' } });
    expect(kept.map(({ call, context }) => ({ server: call.server, tool: call.tool, run: context.runId }))).toEqual([
      { server: 'graph', tool: 'photo', run: runContext().id },
    ]);
    expect(answer).toMatchObject({ content: [{ type: 'image', mimeType: 'image/png', asset: 'asset-1' }, {}] });
    expect(answer).not.toHaveProperty('content.0.data');
  });

  it('stays in the answer as the tool sent it where the runtime gives the capability no way to keep it', async () => {
    const { answer } = await photographed();

    expect(answer).toMatchObject({ content: [{ type: 'image', data: someBytes, mimeType: 'image/png' }, {}] });
  });
});
