import { Schema } from 'effect';

import { RepliesSchema, type Replies } from '../tool-blocks/tool-block-schemas.ts';
import type { KeptRequest } from './reply-taking.ts';

export interface RepliesRoute {
  readonly server: string;
  readonly delivering: string;
  readonly replies: Replies;
}

const routeRowFrom = Schema.decodeUnknownSync(
  Schema.Struct({
    delivery: Schema.fromJsonString(Schema.Struct({ server: Schema.String, tool: Schema.String })),
    replies: Schema.fromJsonString(RepliesSchema),
  }),
);

export function routeOfRequest({ row }: KeptRequest): RepliesRoute {
  const { delivery, replies } = routeRowFrom(row);
  return { server: delivery.server, delivering: delivery.tool, replies };
}
