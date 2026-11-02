import { issueText } from '@on.auto/definitions/document';
import { Conflict, Unavailable } from '@on.auto/operations';
import { alternatives } from '@on.auto/phrasing';
import { Effect } from 'effect';

import type { CatalogEntry } from '../catalog/catalog-entry.ts';
import type { GenerationCatalog } from '../catalog/generation-catalog.ts';
import type { GenerationFunctionDefinitionDocument } from '../document/generation-document.ts';
import { modelChoiceOf } from '../document/model-check.ts';
import type { GenerationGateway } from '../gateway/generation-gateway.ts';

export interface RunnableModel {
  readonly gateway: GenerationGateway;
  readonly entry: CatalogEntry;
}

interface Offering {
  readonly catalog: GenerationCatalog;
  readonly gateways: readonly GenerationGateway[];
}

function gatewaysInWords(gateways: readonly GenerationGateway[]): string {
  return gateways.length === 0
    ? 'this runtime is given no model gateway'
    : `its gateways are ${alternatives(gateways.map(({ name }) => name))}`;
}

export function runnableModel(
  { catalog, gateways }: Offering,
  document: GenerationFunctionDefinitionDocument,
): Effect.Effect<RunnableModel, Conflict | Unavailable> {
  const choice = modelChoiceOf(catalog, document);
  if ('issues' in choice) {
    const said = choice.issues.map((issue) => issueText(issue)).join('; ');
    return Effect.fail(
      new Conflict({ detail: `${said}; update the generation function definition`, kind: 'unworkable' }),
    );
  }
  const { gateway: named, entry } = choice.chosen;
  const gateway = gateways.find(({ name }) => name === named);
  return gateway === undefined
    ? Effect.fail(
        new Unavailable({
          detail: `There is no model gateway named ${named}: ${gatewaysInWords(gateways)}`,
          kind: 'model_not_offered',
        }),
      )
    : Effect.succeed({ gateway, entry });
}
