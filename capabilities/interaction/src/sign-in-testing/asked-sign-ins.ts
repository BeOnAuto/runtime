import { deferredCanceller, defineRunDefinition } from '@on.auto/definitions';
import type { CallerIdentity, Outcome } from '@on.auto/operations';
import { Effect } from 'effect';

import { answerInteraction } from '../requests/answer-interaction.ts';
import { listInteractions } from '../requests/list-interactions.ts';
import { interactionHarness, type InteractionHarness } from '../testing/interaction-harness.ts';
import { signInDocument } from './sign-in-documents.ts';
import { signInTools, type SignInTools } from './sign-in-tools.ts';

export const askedSignInRunId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7d';

export interface AskedSignIn {
  readonly tools: SignInTools;
  readonly playbook: InteractionHarness;
  readonly saved: Outcome;
  readonly asked: Outcome;
  readonly answer: (answering: CallerIdentity, given: unknown) => Promise<Outcome>;
  readonly listed: () => Promise<Outcome>;
  readonly settled: (now?: number) => Promise<Outcome>;
  readonly cancelSettled: () => Promise<Outcome>;
}

export async function signInAskedBy(
  caller: CallerIdentity,
  source = signInDocument(),
  tools = signInTools(),
): Promise<AskedSignIn> {
  const playbook = interactionHarness({ tools });
  const saved = await playbook.define('supplier-portal-sign-in', source);
  const asked = await playbook.call(
    defineRunDefinition(playbook.capabilities),
    { type: 'interaction', name: 'supplier-portal-sign-in', input: {}, run_id: askedSignInRunId },
    caller,
  );
  return {
    tools,
    playbook,
    saved,
    asked,
    answer: (answering, given) =>
      playbook.call(answerInteraction, { run_id: askedSignInRunId, answer: given }, answering),
    listed: () => playbook.call(listInteractions, {}),
    settled: async (now = Date.now() + 1000) => {
      await playbook.performDue(now);
      return playbook.runOf(askedSignInRunId);
    },
    cancelSettled: async () => {
      await playbook.cancel(askedSignInRunId);
      await Effect.runPromise(
        deferredCanceller([playbook.capability], playbook.ledger.service)(
          { org: 'acme', playbook: 'alpha', id: askedSignInRunId },
          { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
          { causationId: null, correlationId: askedSignInRunId },
        ),
      );
      return playbook.runOf(askedSignInRunId);
    },
  };
}
