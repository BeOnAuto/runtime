import type { CapabilityAnswer, CapabilityRejection, RunContext } from '@on.auto/definitions';
import { Clock, Effect, type Schema } from 'effect';

import { generationBounds, type GenerationPorts } from '../capability/generation-ports.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import { generatedBy, type GatewayCall } from '../gateway/gateway-call.ts';
import { askedToWait } from './asked-to-wait.ts';
import { roomLeft } from './asset-room.ts';
import { finishedWith } from './finished-run.ts';
import { preparedRequest } from './prepared-request.ts';
import { runnableModel } from './runnable-model.ts';

export function generationRun(
  ports: GenerationPorts,
): (
  document: GenerationFunctionDefinitionDocument,
  input: Schema.Json,
  context: RunContext,
) => Effect.Effect<CapabilityAnswer, CapabilityRejection> {
  const bounds = ports.bounds ?? generationBounds;
  const answering = ports.answerMs === undefined ? {} : { answerMs: ports.answerMs };
  return (document, input, context) =>
    Effect.gen(function* () {
      const model = yield* runnableModel(ports, document);
      const startedAt = yield* Clock.currentTimeMillis;
      const playbook = { org: context.org, playbook: context.playbook };
      const prepared = yield* preparedRequest(ports, input, { document, model, playbook, now: startedAt });
      yield* roomLeft(ports.ledger, playbook, bounds.mostPlaybookBytes);
      const record = { model: document.model, own_key: ports.ownKey };
      const call: GatewayCall = { gateway: model.gateway, fetch: ports.fetch, record, ...answering };
      const asked = { ...prepared, model, startedAt };
      if (document.produces === 'video') {
        return yield* askedToWait(ports, document, asked, call);
      }
      const generated = yield* generatedBy(call, prepared.request, bounds.mostBytes[document.produces]);
      return yield* finishedWith(ports, document, context, { ...asked, generated });
    });
}
