import { sha256Of, type Digested } from '@on.auto/content';
import { Context, type Schema } from 'effect';

import { mostInlinePayloadBytes, type Payload } from './payload-fields.ts';

const jsonPayloadMediaType = 'application/json';

const textPayloadMediaType = 'text/plain; charset=utf-8';

export interface PayloadText {
  readonly text: string;
  readonly mediaType: string;
}

export interface PayloadToKeep extends PayloadText, Digested {}

export interface ChosenPayload<Value> {
  readonly payload: Payload<Value>;
  readonly toKeep?: PayloadToKeep;
}

export const PayloadsOutside = Context.Reference<boolean>('@on.auto/operations/PayloadsOutside', {
  defaultValue: () => false,
});

const utf8 = new TextEncoder();

export function textBytesOf(text: string): number {
  return utf8.encode(text).byteLength;
}

export function jsonPayloadText(value: Schema.Json): PayloadText {
  return { text: JSON.stringify(value), mediaType: jsonPayloadMediaType };
}

export function textPayloadText(text: string): PayloadText {
  return { text, mediaType: textPayloadMediaType };
}

export function payloadChosen<Value>(
  value: Value,
  { text, mediaType }: PayloadText,
  keepsOutside: boolean,
): ChosenPayload<Value> {
  const bytes = textBytesOf(text);
  if (!keepsOutside || bytes <= mostInlinePayloadBytes || !text.isWellFormed()) {
    return { payload: { inline: value } };
  }
  const sha256 = sha256Of(text);
  return { payload: { kept: { sha256, bytes } }, toKeep: { sha256, bytes, text, mediaType } };
}
