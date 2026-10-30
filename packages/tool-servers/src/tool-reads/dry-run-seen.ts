import type { Unavailable } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { ServerTool, ToolServer } from '../listing/tool-server.ts';
import { notListed } from '../names/tool-naming.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { Reached } from './dry-run-schema.ts';
import { listedTool } from './named-tool.ts';
import { unavailableOf } from './tool-refusals.ts';

export type Seen =
  | { readonly server: Reached; readonly tool: ServerTool }
  | { readonly server: Reached; readonly unseen: string };

const notAsked =
  'The tool server could not be asked for its tools just now, so the input schema of the tool was not read';

const notAllowed = 'Whoever runs this server does not allow the tool, so its input schema was not read';

export function seenOn(
  listed: ToolServer,
  reference: ToolReference,
  allowed: boolean,
): Effect.Effect<Seen, Unavailable> {
  if ('unavailable' in listed) {
    return Effect.succeed({ server: { reachable: 'no', because: listed.because }, unseen: notAsked });
  }
  if (!allowed) {
    return Effect.succeed({ server: { reachable: 'yes' }, unseen: notAllowed });
  }
  return Option.match(listedTool(listed, reference.tool), {
    onNone: () => Effect.fail(unavailableOf(notListed([reference]))),
    onSome: (tool) => Effect.succeed({ server: { reachable: 'yes' }, tool }),
  });
}
