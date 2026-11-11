import { Schema } from 'effect';

import { DeliverySchema } from '../requests/request-rows.ts';
import { RepliesSchema, type Replies } from '../tool-blocks/tool-block-schemas.ts';
import type { KeptRequest } from './reply-taking.ts';

export interface RepliesRoute {
  readonly server: string;
  readonly delivering: string;
  readonly replies: Replies;
  readonly sentIdAt: string | undefined;
}

const routeRowFrom = Schema.decodeUnknownSync(
  Schema.Struct({
    delivery: Schema.fromJsonString(DeliverySchema),
    replies: Schema.fromJsonString(RepliesSchema),
  }),
);

export function routeOfRequest({ row }: KeptRequest): RepliesRoute {
  const { delivery, replies } = routeRowFrom(row);
  return { server: delivery.server, delivering: delivery.tool, replies, sentIdAt: delivery.sent?.id };
}
