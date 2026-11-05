import { Buffer } from 'node:buffer';

import { Schema } from 'effect';

import type { ServerSettings } from '../settings/server-settings.ts';

export interface ImageCall {
  readonly call_id: string;
  readonly server: string;
  readonly connection_id?: string;
  readonly tool: string;
}

export type KeepImage = (bytes: Readonly<Uint8Array>, call: ImageCall) => Promise<string | undefined>;

export type KeepImageOfTheCall = (bytes: Readonly<Uint8Array>) => Promise<string | undefined>;

interface KeptBlock {
  readonly block: unknown;
  readonly kept: boolean;
}

const isImageBlock = Schema.is(Schema.Struct({ type: Schema.Literal('image'), data: Schema.String }));

const isAnswerWithContent = Schema.is(Schema.Struct({ content: Schema.Array(Schema.Unknown) }));

export function imageCallOf(
  callId: string,
  { name, connection }: Pick<ServerSettings, 'name' | 'connection'>,
  tool: string,
): ImageCall {
  return { call_id: callId, server: name, ...(connection === null ? {} : { connection_id: connection }), tool };
}

export function imagesOfTheCall(keep: KeepImage | undefined, call: ImageCall): KeepImageOfTheCall | undefined {
  return keep === undefined ? undefined : (bytes) => keep(bytes, call);
}

function withoutItsBytes(block: { readonly data: string }, asset: string): Readonly<Record<string, unknown>> {
  return {
    ...Object.fromEntries(Object.entries(block).filter(([key]: readonly [string, unknown]) => key !== 'data')),
    asset,
  };
}

async function blockKept(block: unknown, keep: KeepImageOfTheCall): Promise<KeptBlock> {
  if (!isImageBlock(block)) {
    return { block, kept: false };
  }
  const asset = await keep(Buffer.from(block.data, 'base64'));
  return asset === undefined ? { block, kept: false } : { block: withoutItsBytes(block, asset), kept: true };
}

async function keptOutOf(answerJson: string, keep: KeepImageOfTheCall): Promise<string> {
  const answer: unknown = JSON.parse(answerJson);
  if (!isAnswerWithContent(answer)) {
    return answerJson;
  }
  const blocks = await Promise.all(answer.content.map((block) => blockKept(block, keep)));
  return blocks.some(({ kept }) => kept)
    ? JSON.stringify({ ...answer, content: blocks.map(({ block }) => block) })
    : answerJson;
}

export function imagesKeptOutOf(answerJson: string, keep?: KeepImageOfTheCall): Promise<string> {
  return keep === undefined ? Promise.resolve(answerJson) : keptOutOf(answerJson, keep);
}
