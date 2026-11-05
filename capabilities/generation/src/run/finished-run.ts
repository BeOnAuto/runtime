import type { ContentOwner } from '@on.auto/content';
import type { Finished, RunContext } from '@on.auto/definitions';
import { randomUUIDv7, type Conflict, type Context, type Lineage } from '@on.auto/operations';
import { Effect } from 'effect';

import { keptAsset, madeByThe, type MadeByAGeneration } from '../assets/asset-keeping.ts';
import { addressOf, assetReferenceOf } from '../assets/asset-reference.ts';
import type { GenerationPorts } from '../capability/generation-ports.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import type { Generated } from '../gateway/generation-gateway.ts';
import { keptForMsOf, madeByOf, spentOf, type Asked } from './made-by.ts';

export interface Made extends Asked {
  readonly generated: Generated;
}

export interface Keeping {
  readonly id: string;
  readonly playbook: ContentOwner;
  readonly generated: Pick<Generated, 'bytes' | 'mediaType'>;
  readonly madeBy: MadeByAGeneration;
  readonly keptForMs: number;
  readonly context: Omit<Context, 'at'>;
  readonly lineage: Lineage;
  readonly startedAt: number;
}

type FinishingPorts = Pick<GenerationPorts, 'ledger' | 'content' | 'addresses'>;

function keptContext(context: RunContext): Omit<Context, 'at'> {
  return {
    by: context.caller.id,
    runId: context.id,
    definitionType: 'generation',
    definitionName: context.definition.name,
    definitionVersion: context.definition.version,
  };
}

export function recordOf(madeBy: MadeByAGeneration, durationMs: number): Finished['record'] {
  const { model, own_key: ownKey, cost_usd: costUsd } = spentOf(madeBy);
  return { model, own_key: ownKey, duration_ms: durationMs, ...(costUsd === undefined ? {} : { cost_usd: costUsd }) };
}

export function finishedAsset(ports: FinishingPorts, keeping: Keeping): Effect.Effect<Finished, Conflict> {
  return Effect.map(
    keptAsset(ports, {
      id: keeping.id,
      playbook: keeping.playbook,
      bytes: keeping.generated.bytes,
      mediaType: keeping.generated.mediaType,
      ...madeByThe(keeping.madeBy),
      keptForMs: keeping.keptForMs,
      context: keeping.context,
      lineage: keeping.lineage,
    }),
    ({ asset, at }) => ({
      output: assetReferenceOf(asset, addressOf(ports.addresses, keeping.playbook, asset.sha256, at)),
      record: recordOf(keeping.madeBy, at - keeping.startedAt),
    }),
  );
}

export function finishedWith(
  ports: GenerationPorts,
  document: GenerationFunctionDefinitionDocument,
  context: RunContext,
  made: Made,
): Effect.Effect<Finished> {
  return Effect.orDie(
    finishedAsset(ports, {
      id: (ports.newAssetId ?? randomUUIDv7)(),
      playbook: { org: context.org, playbook: context.playbook },
      generated: made.generated,
      madeBy: madeByOf(ports, document, made, made.generated.costUsd),
      keptForMs: keptForMsOf(ports, document),
      context: keptContext(context),
      lineage: { causationId: context.lineage.startId, correlationId: context.lineage.correlationId },
      startedAt: made.startedAt,
    }),
  );
}
