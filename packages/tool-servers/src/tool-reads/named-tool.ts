import { PlaybookContext } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import type { AvailableServer, ServerTool } from '../listing/tool-server.ts';
import { notListed } from '../names/tool-naming.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { unavailableOf, unavailableServerOf } from './tool-refusals.ts';

export type ToolLookup = Pick<ToolAccess, 'lookUp'>;

export function listedTool({ tools }: AvailableServer, name: string): Option.Option<ServerTool> {
  return Option.fromNullishOr(tools.find((tool) => tool.name === name));
}

export const namedToolOf = Effect.fnUntraced(function* (access: ToolLookup, reference: ToolReference) {
  const address = yield* PlaybookContext;
  const { naming, listed } = yield* access.lookUp(address, reference);
  yield* Effect.mapError(Effect.fromResult(naming), unavailableOf);
  const server = yield* listed;
  if ('unavailable' in server) {
    return yield* Effect.fail(unavailableServerOf(server));
  }
  const found = listedTool(server, reference.tool);
  if (Option.isNone(found)) {
    return yield* Effect.fail(unavailableOf(notListed([reference])));
  }
  return found.value;
});
