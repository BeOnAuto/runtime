import type { FinishesLater } from '@on.auto/definitions';
import { Clock, Effect } from 'effect';

import { generationBounds, type GenerationPorts } from '../capability/generation-ports.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import type { GatewayCall } from '../gateway/gateway-call.ts';
import type { GatewayRefusal } from '../gateway/gateway-refusals.ts';
import { videoAskedOf } from '../gateway/video-call.ts';
import type { GenerationWait } from '../waiting/generation-wait.ts';
import { keptForMsOf, madeByOf, type Asked } from './made-by.ts';

export function askedToWait(
  ports: GenerationPorts,
  document: GenerationFunctionDefinitionDocument,
  asked: Asked,
  call: GatewayCall,
): Effect.Effect<FinishesLater, GatewayRefusal> {
  return Effect.gen(function* () {
    const video = yield* videoAskedOf(call, asked.request);
    const now = yield* Clock.currentTimeMillis;
    const wait: GenerationWait = {
      ...madeByOf(ports, document, asked, video.costUsd),
      handle: video.handle,
      kept_for_ms: keptForMsOf(ports, document),
      asked_at: new Date(asked.startedAt).toISOString(),
      waits_until: new Date(now + (ports.bounds ?? generationBounds).waitMs).toISOString(),
    };
    return { finishesLater: true, record: wait };
  });
}
