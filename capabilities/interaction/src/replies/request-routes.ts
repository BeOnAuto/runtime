import { Schema } from 'effect';

import { DeliverySchema } from '../requests/request-rows.ts';
import { tellsALine } from '../tellings/telling-calls.ts';
import { TellingRouteSchema, type TellingRoute } from '../tellings/telling-routes.ts';
import { RepliesSchema, type Replies } from '../tool-blocks/tool-block-schemas.ts';
import type { KeptRequest } from './reply-taking.ts';

export interface RepliesRoute {
  readonly server: string;
  readonly delivering: string;
  readonly replies: Replies;
  readonly telling: TellingRoute;
}

const routeRowFrom = Schema.decodeUnknownSync(
  Schema.Struct({
    delivery: Schema.fromJsonString(DeliverySchema),
    replies: Schema.NullOr(Schema.fromJsonString(RepliesSchema)),
    tell: Schema.NullOr(Schema.fromJsonString(TellingRouteSchema)),
  }),
);

function noReadingOf(tool: string): Replies {
  return { tool, with: {}, read: { list: '', order: 'oldest_first', each: { id: '', sender: '', text: '' } } };
}

export function routeOfRequest({ row }: KeptRequest): RepliesRoute {
  const { delivery, replies, tell } = routeRowFrom(row);
  return {
    server: delivery.server,
    delivering: delivery.tool,
    replies: replies ?? noReadingOf(delivery.tool),
    telling: tell ?? { when: 'none' },
  };
}

export function tellsTakenAndRefused(request: KeptRequest): boolean {
  const { telling } = routeOfRequest(request);
  return tellsALine(telling, 'taken') && tellsALine(telling, 'refused');
}
