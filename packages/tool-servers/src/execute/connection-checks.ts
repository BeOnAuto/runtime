import { Effect } from 'effect';

import { refusedOutsideTheListing } from '../access/directory-listing.ts';
import type { OfferedTool } from '../calls/offered-tools.ts';
import type { RunTools } from '../calls/run-tools.ts';
import { toolNotReads } from './tool-not-reads.ts';

export function readsOnlyIn(tools: RunTools, offered: OfferedTool) {
  return offered.readOnly
    ? Effect.succeed(offered)
    : Effect.promise(() => tools.close()).pipe(Effect.andThen(Effect.fail(toolNotReads(offered.reference))));
}

export function inTheListing(tools: RunTools, offered: OfferedTool) {
  return refusedOutsideTheListing(offered.reference.server, offered.server).pipe(
    Effect.tapError(() => Effect.promise(() => tools.close())),
    Effect.as(offered),
  );
}
