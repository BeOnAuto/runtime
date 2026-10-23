import { textOfContent } from '@on.auto/operations';
import { Effect, Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { answers } from '../testing/scripted-language-model.ts';
import { secretOfTheServers, stepsOf, toolOf, type StepsRun } from '../testing/step-runs.ts';

const search = toolOf('graph', 'search');

const twoSteps = [
  answers(toolCallsResult([['graph__search', { query: 'acme' }]])),
  answers(toolCallsResult([['graph__search', { query: 'globex' }]])),
  answers(textResult('Acme and globex have 2 rows each.')),
];

function keptText({ content }: StepsRun, sha256: string): Promise<string> {
  return Effect.runPromise(
    content
      .get({ org: 'acme', playbook: 'alpha' }, sha256)
      .pipe(Effect.flatMap(Effect.fromNullishOr), Effect.flatMap(textOfContent), Effect.orDie),
  );
}

const Digested = Schema.Struct({
  messages_sha256: Schema.optional(Schema.String),
  response_sha256: Schema.optional(Schema.String),
});

const KindOf = Schema.fromJsonString(Schema.Struct({ kind: Schema.String }));

function digestsOf({ journal }: StepsRun, field: 'messages_sha256' | 'response_sha256'): readonly string[] {
  return journal
    .recorded()
    .flatMap(({ data }) => Option.toArray(Option.fromNullishOr(Schema.decodeUnknownSync(Digested)(data)[field])));
}

describe('the content a run keeps of its model calls', () => {
  it('is the new messages of each step under their digest, never the conversation again, and each answer', async () => {
    const steps = stepsOf({ tools: [search], replies: twoSteps });
    await Effect.runPromise(steps.stepping);
    const sent = await Promise.all(digestsOf(steps, 'messages_sha256').map((digest) => keptText(steps, digest)));
    const answered = await Promise.all(digestsOf(steps, 'response_sha256').map((digest) => keptText(steps, digest)));

    expect(sent.map((text) => Schema.decodeUnknownSync(KindOf)(text).kind)).toEqual(['prompt', 'results', 'results']);
    expect(sent.filter((text) => text.includes('Find acme.'))).toHaveLength(1);
    expect(sent.filter((text) => text.includes('Found 2 rows.'))).toHaveLength(2);
    expect(answered).toHaveLength(3);
    expect(answered.at(-1)).toContain('Acme and globex have 2 rows each.');
  });

  it('holds no secret of the servers, and the run goes on from what it kept, as a resumed run does', async () => {
    const steps = stepsOf({
      tools: [search],
      prompt: { kind: 'prompt', message: `Find acme, whose key is ${secretOfTheServers}.` },
      replies: [
        answers(toolCallsResult([['graph__search', { query: `the key is ${secretOfTheServers}` }]])),
        answers(textResult('Searched.')),
      ],
    });
    await Effect.runPromise(steps.stepping);
    const kept = await Promise.all(
      [...digestsOf(steps, 'messages_sha256'), ...digestsOf(steps, 'response_sha256')].map((digest) =>
        keptText(steps, digest),
      ),
    );

    expect(kept.filter((text) => text.includes(secretOfTheServers))).toEqual([]);
    expect(kept.filter((text) => text.includes('key is [redacted]'))).toHaveLength(2);
    expect(steps.sends().map(({ input }) => input)).toEqual([{ query: 'the key is [redacted]' }]);
    expect(JSON.stringify(steps.requests())).not.toContain(secretOfTheServers);
  });

  it('is nothing for a run whose servers keep no content, whose facts carry the sizes alone', async () => {
    const steps = stepsOf({ tools: [search], replies: twoSteps, keepsContent: false });
    await Effect.runPromise(steps.stepping);

    expect([digestsOf(steps, 'messages_sha256'), digestsOf(steps, 'response_sha256')]).toEqual([[], []]);
    expect(steps.journal.recorded().find(({ type }) => type === 'model_call_answered')?.data).toMatchObject({
      tool_calls: [{ call_id: 'call-1', tool: 'search', server: 'graph' }],
    });
    expect(JSON.stringify(steps.journal.recorded())).not.toContain('arguments_sha256');
  });
});
