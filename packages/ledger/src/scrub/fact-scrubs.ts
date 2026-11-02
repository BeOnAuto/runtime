import type { FactScrubber } from '@on.auto/operations';

import type { RiddenAppends } from '../emmett/emmett-event-store.ts';
import type { FactScrubStore } from '../event-store.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import type { ProjectionKeeping } from '../projections/projection-keeping.ts';
import type { ContentReferences } from '../references/content-references.ts';
import { afterTheHook, appendRiders, type AppendRiders } from './append-riders.ts';
import { factScrubberOf } from './fact-scrub.ts';
import { factAtOn, scrubWithin, type ReadQuery } from './scrubbed-facts.ts';

export interface FactScrubs {
  readonly riders: AppendRiders;
  readonly afterTheHook: typeof afterTheHook;
  readonly storeOver: (streams: RiddenAppends, query: ReadQuery) => FactScrubStore & FactScrubber;
}

export function factScrubsOf(
  dialect: ProjectionDialect,
  keepings: readonly ProjectionKeeping[],
  references: Pick<ContentReferences, 'refolded'>,
): FactScrubs {
  return {
    riders: appendRiders(),
    afterTheHook,
    storeOver: (streams, query) => {
      const store: FactScrubStore = {
        factAt: factAtOn(dialect, query),
        scrub: (stream, scrubbed, erasure, place) =>
          streams.appendWithin(
            stream,
            erasure,
            place,
            scrubWithin({ dialect, keepings, references }, stream, scrubbed),
          ),
      };
      return { ...store, ...factScrubberOf(store) };
    },
  };
}
