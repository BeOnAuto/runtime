import type { CapabilityAnswer, RunAttempt } from '@on.auto/definitions';
import type { CallerIdentity } from '@on.auto/operations';
import { serveFakeMcp } from '@on.auto/tool-servers/served-fakes';
import { askingForApproval, reportingAccess } from '@on.auto/tool-servers/testing';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import { documentOf } from './definition-documents.ts';
import { textResult, toolCallsResult } from './model-results.ts';
import { acmeAdmin, firstAttempt, moment, reasoningOf, type Reasoning, type Run } from './reasoning-runs.ts';
import { answers } from './scripted-language-model.ts';

const shopKey = 'shop-api-key-5e2a9c71';

export const priya: CallerIdentity = { ...acmeAdmin, id: 'person:user_7kLm2', name: 'Priya Shah' };

const paying = documentOf('model: anthropic/claude-sonnet-4-5\ntools: [graph/pay]', 'Pay for order A-17.');

export const signing: NonNullable<Reasoning['approvals']> = {
  sign: ({ person, asked }) => Effect.succeed(`approval of ${person} for ${String(asked.request)} ${asked.digest}`),
};

async function answerOf(running: Promise<Run>): Promise<CapabilityAnswer> {
  return Effect.runPromise(await running);
}

export async function askedFirst(given: Partial<Reasoning> = {}) {
  const fake = await serveFakeMcp({ bearer: shopKey, tools: [askingForApproval()] });
  onTestFinished(() => fake.close());
  const { access: tools, content } = reportingAccess(
    { graph: { url: fake.url, headers: { Authorization: 'Bearer ${SHOP_KEY}' }, org: 'acme' } },
    { environment: { SHOP_KEY: shopKey } },
  );
  onTestFinished(() => tools.close());
  const first = reasoningOf(
    { tools, content, approvals: signing, caller: priya, ...given },
    answers(toolCallsResult([['graph__pay', { order: 'A-17' }]])),
    answers(textResult('It needs an approval nobody can give.')),
  );
  const answered = await answerOf(first.running(paying));
  return { fake, tools, content, first, answered };
}

export async function wentOn(approvals: NonNullable<Reasoning['approvals']>) {
  const { fake, tools, content, answered, first } = await askedFirst();
  const attempt: RunAttempt = {
    ...firstAttempt,
    calls: first.journal.calls(),
    requests: 1,
    waitedMs: 60_000,
    request: {
      record: answered.record,
      at: moment,
      answer: { answer: { approved: true }, by: { id: priya.id, name: priya.name }, at: moment },
    },
  };
  const second = reasoningOf({ tools, content, approvals, caller: priya, attempt }, answers(textResult('Paid.')));
  return { fake, second, answered: await answerOf(second.running(paying)) };
}
