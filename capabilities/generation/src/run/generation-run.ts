import type { CapabilityRejection, Finished, RunContext } from '@on.auto/definitions';
import { Unavailable } from '@on.auto/operations';
import { Clock, Effect, type Schema } from 'effect';

import { generationBounds, type GenerationPorts } from '../capability/generation-ports.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import { generatedBy } from '../gateway/gateway-call.ts';
import { roomLeft } from './asset-room.ts';
import { finishedWith } from './finished-run.ts';
import { preparedRequest } from './prepared-request.ts';
import { runnableModel } from './runnable-model.ts';

const videoWaits = new Unavailable({
  detail:
    'This runtime saves a generation function that produces video, but does not run one yet: it cannot yet wait while a provider makes a video',
});

export function generationRun(
  ports: GenerationPorts,
): (
  document: GenerationFunctionDefinitionDocument,
  input: Schema.Json,
  context: RunContext,
) => Effect.Effect<Finished, CapabilityRejection> {
  const bounds = ports.bounds ?? generationBounds;
  const answering = ports.answerMs === undefined ? {} : { answerMs: ports.answerMs };
  return (document, input, context) =>
    Effect.gen(function* () {
      const { produces } = document;
      if (produces === 'video') {
        return yield* Effect.fail(videoWaits);
      }
      const model = yield* runnableModel(ports, document);
      const startedAt = yield* Clock.currentTimeMillis;
      const playbook = { org: context.org, playbook: context.playbook };
      const prepared = yield* preparedRequest(ports, input, {
        document: { ...document, produces },
        model,
        playbook,
        now: startedAt,
      });
      yield* roomLeft(ports.ledger, playbook, bounds.mostPlaybookBytes);
      const record = { model: document.model, own_key: ports.ownKey };
      const call = { gateway: model.gateway, fetch: ports.fetch, record, ...answering };
      const generated = yield* generatedBy(call, prepared.request, bounds.mostBytes[produces]);
      return yield* finishedWith(ports, document, context, { ...prepared, model, generated, startedAt });
    });
}
