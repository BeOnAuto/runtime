import {
  declaredFactsOf,
  deferredCanceller,
  runFactsOf,
  workRecorder,
  type Capability,
  type RecordedWorkAt,
} from '@on.auto/definitions';
import { Ledger } from '@on.auto/operations';
import { Effect, Layer, Schema } from 'effect';

import { interactionType } from '../capability/interaction-type.ts';
import { interactionFacts } from '../facts/declared-facts.ts';
import { askedRunId } from './asked-requests.ts';
import type { HarnessLedger } from './interaction-harness.ts';

const Deciding = Schema.Struct({ type: Schema.Literals(['settle', 'answer']) });

const isDeciding = Schema.is(Schema.Union([Deciding, Schema.Struct({ command: Deciding })]));

const address = { org: 'acme', playbook: 'alpha', id: askedRunId };

const lineage = { causationId: null, correlationId: askedRunId };

const factsOfTheInteraction = runFactsOf(declaredFactsOf([{ type: interactionType, facts: interactionFacts }]));

export const takenReply = { id: '1699.2', sender: 'ada' };

export interface RacingDelivery {
  readonly ledger: HarnessLedger;
  readonly started: () => Promise<void>;
  readonly cancelSettled: (capability: Capability) => Promise<void>;
}

function answeredByAReplyIn(ledger: HarnessLedger, answer: Schema.Json): Effect.Effect<RecordedWorkAt, unknown> {
  return workRecorder(ledger.service, factsOfTheInteraction)(
    address,
    { type: 'answer', answer: { answer, reply: takenReply } },
    lineage,
  );
}

export function recordedReply(ledger: HarnessLedger, answer: Schema.Json): Promise<unknown> {
  return Effect.runPromise(answeredByAReplyIn(ledger, answer));
}

function broughtOf(ledger: HarnessLedger, answer: Schema.Json | undefined): Effect.Effect<RecordedWorkAt, unknown> {
  return answer === undefined
    ? workRecorder(ledger.service, factsOfTheInteraction)(
        address,
        {
          type: 'work',
          fact: {
            type: 'delivery_succeeded',
            data: { number: 1, result_bytes: 2, result_sha256: 'd'.repeat(64), duration_ms: 3, jsonrpc_id: 1 },
          },
        },
        lineage,
      )
    : answeredByAReplyIn(ledger, answer);
}

export function broughtBeforeDeciding(ledger: HarnessLedger, answer?: Schema.Json): RacingDelivery {
  const brought = broughtOf(ledger, answer);
  const pending = { bringing: true };
  const service: Ledger['Service'] = {
    ...ledger.service,
    execute: (stream, decider, command, given) => {
      const settling = ledger.service.execute(stream, decider, command, given);
      if (!isDeciding(command) || !pending.bringing) {
        return settling;
      }
      pending.bringing = false;
      return Effect.andThen(Effect.orDie(brought), settling);
    },
  };
  return {
    ledger: { service, layer: Layer.succeed(Ledger, service) },
    cancelSettled: (capability) =>
      Effect.runPromise(
        deferredCanceller([capability], service)(
          address,
          { kind: 'requested', reason: 'Not needed any more', by: 'acme-admin' },
          lineage,
        ),
      ),
    started: () =>
      Effect.runPromise(
        Effect.asVoid(
          workRecorder(ledger.service, factsOfTheInteraction)(
            address,
            {
              type: 'work',
              fact: {
                type: 'delivery_started',
                data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' },
              },
            },
            lineage,
          ),
        ),
      ),
  };
}
