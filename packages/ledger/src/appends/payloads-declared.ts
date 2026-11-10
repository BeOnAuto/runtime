import { contentHoldersOf, type ContentHolders } from '@on.auto/operations';
import { payloadsNamed } from '@on.auto/operations/payloads';
import type { SchemaAST } from 'effect';

import type { EncodedEvent } from '../event-store.ts';

const declaredBySchema = new WeakMap<object, ContentHolders>();

export function payloadsDeclaredBy(schema: { readonly ast: SchemaAST.AST }): ContentHolders {
  const known = declaredBySchema.get(schema);
  if (known !== undefined) {
    return known;
  }
  const declared = contentHoldersOf([schema]);
  declaredBySchema.set(schema, declared);
  return declared;
}

function payloadBytesNamed(holders: ContentHolders, { type, data }: EncodedEvent): number | undefined {
  const declaration = holders.get(type);
  const named = declaration === undefined ? [] : payloadsNamed(data, declaration);
  return named.length === 0 ? undefined : named.reduce((total, { bytes }) => total + bytes, 0);
}

export function measuredWhole(declared: ContentHolders, event: EncodedEvent): EncodedEvent {
  const payloadBytes = payloadBytesNamed(declared, event);
  return payloadBytes === undefined ? { type: event.type, data: event.data } : { ...event, payloadBytes };
}

function bytesOf(payloadBytes: number | undefined): number {
  return payloadBytes ?? 0;
}

export function requireHeldAsMeasured(holders: ContentHolders, stream: string, event: EncodedEvent): void {
  const held = payloadBytesNamed(holders, event);
  if (held !== event.payloadBytes) {
    throw new Error(
      `A fact ${event.type} of ${stream} keeps ${bytesOf(event.payloadBytes)} bytes of payloads outside by its schema, where the ledger's holders count ${bytesOf(held)}, so the ledger would not hold them; the ledger must be opened with the schema of every fact that keeps a payload`,
    );
  }
}
