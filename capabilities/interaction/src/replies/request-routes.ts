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
    replies: Schema.fromJsonString(RepliesSchema),
    tell: Schema.fromJsonString(TellingRouteSchema),
  }),
);

export function routeOfRequest({ row }: KeptRequest): RepliesRoute {
  const { delivery, replies, tell } = routeRowFrom(row);
  return { server: delivery.server, delivering: delivery.tool, replies, telling: tell };
}

export function tellsTakenAndRefused(request: KeptRequest): boolean {
  const { telling } = routeOfRequest(request);
  return tellsALine(telling, 'taken') && tellsALine(telling, 'refused');
}
