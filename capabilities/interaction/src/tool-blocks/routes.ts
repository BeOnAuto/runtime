import { toolInWords } from '@on.auto/tool-servers';
import type { ToolReference } from '@on.auto/tool-servers/policy';

import type { Replies } from './tool-block-schemas.ts';

export interface RecordedBlocks {
  readonly deliver?: ToolReference | undefined;
  readonly replies?: Replies | undefined;
}

export type Route =
  | { readonly kind: 'agent' }
  | { readonly kind: 'tool'; readonly delivery: ToolReference; readonly replies?: Replies };

const heldForAnAgent: Route = { kind: 'agent' };

export function routeOf({ deliver, replies }: RecordedBlocks): Route {
  if (deliver === undefined) {
    return heldForAnAgent;
  }
  const delivery = { server: deliver.server, tool: deliver.tool };
  return replies === undefined ? { kind: 'tool', delivery } : { kind: 'tool', delivery, replies };
}

export function throughWords(route: Route): string {
  return route.kind === 'agent' ? 'held for an agent' : `through ${toolInWords(route.delivery)}`;
}

export function toolsOf(route: Route): readonly ToolReference[] {
  if (route.kind === 'agent') {
    return [];
  }
  const { delivery, replies } = route;
  const tools = [delivery.tool, replies?.tool, replies?.tell?.tool].filter((tool) => tool !== undefined);
  return [...new Set(tools)].map((tool) => ({ server: delivery.server, tool }));
}
