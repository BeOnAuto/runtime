import type { FactScrubber } from '@on.auto/operations';

import type { RiddenAppends } from '../emmett/emmett-event-store.ts';
import type { FactScrubStore } from '../event-store.ts';
import type { ProjectionDialect } from '../projections/projection-dialect.ts';
import type { ProjectionKeeping } from '../projections/projection-keeping.ts';
import type { ContentReferences } from '../references/content-references.ts';
import type { StreamProjectionParts } from '../stream-projections/stream-projection-parts.ts';
import { afterTheHook, appendRiders, type AppendRiders } from './append-riders.ts';
import { factScrubberOf } from './fact-scrub.ts';
import { factAtOn, scrubWithin, type ReadQuery } from './scrubbed-facts.ts';

export interface FactScrubs {
  readonly riders: AppendRiders;
  readonly afterTheHook: typeof afterTheHook;
  readonly storeOver: (streams: RiddenAppends, query: ReadQuery) => FactScrubStore & FactScrubber;
}

interface RefoldedBeside {
  readonly references: Pick<ContentReferences, 'refolded'>;
  readonly streams: Pick<StreamProjectionParts, 'scrubbed'>;
}

export function factScrubsOf(
  dialect: ProjectionDialect,
  keepings: readonly ProjectionKeeping[],
  beside: RefoldedBeside,
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
            [erasure],
            place,
            scrubWithin({ dialect, keepings, ...beside }, stream, scrubbed),
          ),
      };
      return { ...store, ...factScrubberOf(store) };
    },
  };
}
