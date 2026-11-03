import type { MadeBy } from '../assets/asset-keeping.ts';
import { generationBounds, type GenerationPorts } from '../capability/generation-ports.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import type { PreparedRequest } from './prepared-request.ts';
import type { RunnableModel } from './runnable-model.ts';

export interface Asked extends PreparedRequest {
  readonly model: RunnableModel;
  readonly startedAt: number;
}

export type Spent = Pick<MadeBy, 'model' | 'own_key' | 'cost_usd'>;

function costOf(costUsd: number | undefined): Pick<MadeBy, 'cost_usd'> {
  return costUsd === undefined ? {} : { cost_usd: costUsd };
}

export function spentOf(madeBy: Spent): Spent {
  return { model: madeBy.model, own_key: madeBy.own_key, ...costOf(madeBy.cost_usd) };
}

export function madeByOf(
  ports: Pick<GenerationPorts, 'ownKey'>,
  document: GenerationFunctionDefinitionDocument,
  asked: Asked,
  costUsd: number | undefined,
): MadeBy {
  return {
    kind: asked.model.entry.kind,
    model: document.model,
    prompt: asked.request.prompt,
    parameters: asked.request.parameters,
    references: asked.references.map(({ id, sha256 }) => ({ id, sha256 })),
    ...costOf(costUsd),
    own_key: ports.ownKey,
  };
}

export function keptForMsOf(
  ports: Pick<GenerationPorts, 'bounds'>,
  document: GenerationFunctionDefinitionDocument,
): number {
  return document.expiresMs ?? (ports.bounds ?? generationBounds).keptMs;
}
