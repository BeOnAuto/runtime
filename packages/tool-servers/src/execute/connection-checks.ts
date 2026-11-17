import { InvalidInput } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { refusedOutsideTheListing } from '../access/directory-listing.ts';
import type { OfferedTool } from '../calls/offered-tools.ts';
import type { RunTools } from '../calls/run-tools.ts';
import type { AssetsNotSent } from '../sent-assets/planned-assets.ts';
import type { HandCall } from './executed-call.ts';
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

function refusedByHand({ pointer, detail }: AssetsNotSent): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer: `/arguments${pointer}`, detail }] });
}

export const plannedIn = Effect.fnUntraced(function* (tools: RunTools, offered: OfferedTool, called: HandCall) {
  const planned = yield* Effect.result(offered.planned(called.input));
  if (Result.isFailure(planned)) {
    yield* Effect.promise(() => tools.close());
    return yield* Effect.fail(refusedByHand(planned.failure));
  }
  const { sent } = planned.success;
  return sent.length === 0 ? called : { ...called, assets: sent };
});
