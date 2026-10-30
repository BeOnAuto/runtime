import { Effect, Result } from 'effect';

import type { KeepIn } from '../calls/recorded-calls.ts';
import type { RunToolsParts } from '../calls/run-parts.ts';
import { runTools, type RunTools } from '../calls/run-tools.ts';
import { ignored } from '../clients/ignored.ts';
import type { ServerLink } from '../clients/server-links.ts';
import { listedOn, released } from '../listing/server-listing.ts';
import { notListed, offeredOn, unlistedOn, type Listed, type Offering } from '../names/tool-naming.ts';
import { refusalOf, type Unusable } from '../org-servers/server-refusals.ts';
import type { ToolsNotOpened } from './caller-context.ts';

export interface Opening extends Offering, Pick<RunToolsParts, 'context' | 'secrets' | 'timing' | 'report'> {
  readonly links: readonly ServerLink[];
  readonly keepIn: KeepIn;
}

type Listing = Promise<Result.Result<readonly Listed[], Unusable>>;

function releasedOnceSettled(listing: Listing): Effect.Effect<void> {
  return Effect.sync(() => {
    void listing
      .then(Result.getOrElse((): readonly Listed[] => []))
      .then(released)
      .catch(ignored);
  });
}

export function openedRun(opening: Opening): Effect.Effect<RunTools, ToolsNotOpened> {
  return Effect.gen(function* () {
    const context = yield* Effect.context();
    const listing = yield* Effect.sync(() => listedOn(opening.links, opening));
    const settled = yield* Effect.promise(() => listing).pipe(Effect.onInterrupt(() => releasedOnceSettled(listing)));
    const listed = yield* Effect.mapError(Effect.fromResult(settled), refusalOf);
    const missing = listed.flatMap((each) => unlistedOn(each, opening));
    if (missing.length > 0) {
      yield* Effect.promise(() => released(listed));
      return yield* notListed(missing);
    }
    return runTools({
      ...opening,
      keep: opening.keepIn(opening.context),
      slots: listed.map(({ slot }) => slot),
      offered: listed.flatMap((each) => offeredOn(each, opening)),
      run: Effect.runPromiseWith(context),
    });
  });
}
