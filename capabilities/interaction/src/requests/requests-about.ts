import { PlaybookReader, type PlaybookContext } from '@on.auto/operations';
import { Array as Arr, Effect } from 'effect';

import { openRequestsName } from './open-requests.ts';
import { requestChainOf } from './request-causes.ts';
import { requestRowFrom } from './request-rows.ts';
import type { RequestThing, RequestThings } from './requests-set-aside.ts';

const mostRequestsSearched = 100;

type RequestsAbout = (
  thing: Pick<RequestThing, 'goal' | 'id'>,
) => Effect.Effect<readonly string[], never, PlaybookReader | PlaybookContext>;

function isTheThing({ goal, id }: Pick<RequestThing, 'goal' | 'id'>, about: RequestThing): boolean {
  return about.goal === goal && about.id === id;
}

export function requestsAskingAbout(things: RequestThings): RequestsAbout {
  return (thing) =>
    Effect.gen(function* () {
      const rows = yield* (yield* PlaybookReader).readProjectedRows(openRequestsName, {
        where: [{ column: 'open', equals: true }],
        orderBy: ['requested_at'],
        order: 'desc',
        limit: mostRequestsSearched,
      });
      const chains = yield* Effect.forEach(rows, ({ row }) => requestChainOf(requestRowFrom(row)));
      const about = yield* things(
        chains.map(({ causes = [] }) => causes),
        { dismissed: 'include' },
      );
      return Arr.zipWith(rows, about, ({ key }, tied) =>
        tied.some((each) => isTheThing(thing, each)) ? [key] : [],
      ).flat();
    });
}
