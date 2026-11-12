import type { Effect } from 'effect';
import { Schema } from 'effect';

import {
  tellBlockOf,
  tellWords,
  type DeliverBlock,
  type Replies,
  type TellBlock,
} from '../tool-blocks/tool-block-schemas.ts';

const Templates = Schema.Record(Schema.String, Schema.Json);

const LineSchema = Schema.Struct({
  tool: Schema.String,
  with: Templates,
  sent: Schema.optionalKey(Schema.String),
  conversationAt: Schema.optionalKey(Schema.String),
});

const MarkSchema = Schema.Struct({ tool: Schema.String, with: Templates });

const ReadLimitSchema = Schema.Struct({ quota: Schema.Int, windowSeconds: Schema.Int });

export const TellingRouteSchema = Schema.Struct({
  when: Schema.Literals(tellWords),
  line: Schema.optionalKey(LineSchema),
  mark: Schema.optionalKey(MarkSchema),
  automatic: Schema.optionalKey(Schema.String),
  tellsOthers: Schema.optionalKey(Schema.Boolean),
  readLimit: Schema.optionalKey(ReadLimitSchema),
});

export type ReadLimit = typeof ReadLimitSchema.Type;

export type TellingRoute = typeof TellingRouteSchema.Type;

type Line = typeof LineSchema.Type;

export interface ConversationTools {
  readonly tell: 'all' | 'refusals';
  readonly reply: {
    readonly tool: string;
    readonly with: Readonly<Record<string, Schema.Json>>;
    readonly sent: string;
  };
  readonly react?: { readonly tool: string; readonly with: Readonly<Record<string, Schema.Json>> };
  readonly automatic?: string;
  readonly read_limit?: { readonly quota: number; readonly window_seconds: number };
}

export type ConversationsOf = (provider: string | null) => Effect.Effect<ConversationTools | undefined>;

const toldNothing: TellingRoute = { when: 'none' };

export type Delivering = Pick<DeliverBlock, 'tool' | 'sent'>;

function lineOf(block: TellBlock, { tool: delivering, sent: pointers }: Delivering): Line {
  const tool = block.tool ?? delivering;
  const ofTheDelivery = tool === delivering ? pointers : undefined;
  const sent = block.sent ?? ofTheDelivery?.id;
  return {
    tool,
    with: block.with,
    ...(sent === undefined ? {} : { sent }),
    ...(ofTheDelivery === undefined ? {} : { conversationAt: ofTheDelivery.conversation }),
  };
}

function readAs(part: ConversationTools | undefined): Pick<TellingRoute, 'automatic' | 'readLimit'> {
  const limit = part?.read_limit;
  return {
    ...(part?.automatic === undefined ? {} : { automatic: part.automatic }),
    ...(limit === undefined ? {} : { readLimit: { quota: limit.quota, windowSeconds: limit.window_seconds } }),
  };
}

function ofTheProvider(
  part: ConversationTools | undefined,
): Pick<TellingRoute, 'mark' | 'automatic' | 'readLimit' | 'tellsOthers'> {
  return {
    ...(part?.react === undefined ? {} : { mark: part.react }),
    ...readAs(part),
    ...(part?.tell === 'all' ? { tellsOthers: true } : {}),
  };
}

export function resolvedTelling(deliver: DeliverBlock, replies: Replies, part?: ConversationTools): TellingRoute {
  const { tell } = replies;
  if (tell === 'none') {
    return { ...toldNothing, ...readAs(part) };
  }
  if (typeof tell === 'object') {
    const line = lineOf(tell, deliver);
    return { when: tell.when ?? part?.tell ?? 'refusals', line, ...ofTheProvider(part) };
  }
  if (part === undefined) {
    return tell === undefined ? toldNothing : { when: tell };
  }
  return { when: tell ?? part.tell, line: part.reply, ...ofTheProvider(part) };
}

export function tellingWrittenBefore(replies: Replies, delivering: Delivering): TellingRoute {
  const block = tellBlockOf(replies);
  return block === undefined ? toldNothing : { when: 'refusals', line: lineOf(block, delivering) };
}
