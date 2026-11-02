import type { Finished, RunContext } from '@on.auto/definitions';
import { randomUUIDv7, type Context } from '@on.auto/operations';
import { Clock, Effect, type Schema } from 'effect';

import { keptAsset } from '../assets/asset-keeping.ts';
import { addressOf, assetReferenceOf } from '../assets/asset-reference.ts';
import { generationBounds, type GenerationPorts } from '../capability/generation-ports.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import type { Generated } from '../gateway/generation-gateway.ts';
import type { PreparedRequest } from './prepared-request.ts';
import type { RunnableModel } from './runnable-model.ts';

export interface Made extends PreparedRequest {
  readonly model: RunnableModel;
  readonly generated: Generated;
  readonly startedAt: number;
}

function keptContext(context: RunContext, at: string): Context {
  return {
    at,
    by: context.caller.id,
    runId: context.id,
    definitionType: 'generation',
    definitionName: context.definition.name,
    definitionVersion: context.definition.version,
  };
}

function costOf({ costUsd }: Generated): { readonly cost_usd?: number } {
  return costUsd === undefined ? {} : { cost_usd: costUsd };
}

export function finishedWith(
  ports: GenerationPorts,
  document: GenerationFunctionDefinitionDocument,
  context: RunContext,
  made: Made,
): Effect.Effect<Finished> {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const playbook = { org: context.org, playbook: context.playbook };
    const keptMs = document.expiresMs ?? (ports.bounds ?? generationBounds).keptMs;
    const asset = yield* keptAsset(ports, {
      id: (ports.newAssetId ?? randomUUIDv7)(),
      playbook,
      bytes: made.generated.bytes,
      mediaType: made.generated.mediaType,
      kept: {
        kind: made.model.entry.kind,
        model: document.model,
        prompt: made.request.prompt,
        parameters: made.request.parameters,
        references: made.references.map(({ id, sha256 }) => ({ id, sha256 })),
        ...costOf(made.generated),
        own_key: ports.ownKey,
        expires_at: new Date(now + keptMs).toISOString(),
      },
      context: keptContext(context, new Date(now).toISOString()),
      lineage: { causationId: context.lineage.startId, correlationId: context.lineage.correlationId },
    });
    const record: Schema.JsonObject = {
      model: document.model,
      own_key: ports.ownKey,
      duration_ms: now - made.startedAt,
      ...costOf(made.generated),
    };
    return { output: assetReferenceOf(asset, addressOf(ports.addresses, playbook, asset.sha256, now)), record };
  });
}
