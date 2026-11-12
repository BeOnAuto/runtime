import { sha256Of } from '@on.auto/content';
import {
  ActedContextSchema,
  factOf,
  streamPrefixOfOrg,
  type Context,
  type Decided,
  type Decider,
  type Fold,
} from '@on.auto/operations';
import { Result, Schema } from 'effect';

import type { CommandMetadata } from '../registry/connection-commands.ts';
import { bytesOfText } from '../registry/connection-entry.ts';

const connectionDocumentsKind = 'connection-documents';

const aFingerprint = /^[0-9a-f]{64}$/u;

export function documentStreamOf(sha256: string): string {
  return `${connectionDocumentsKind}/${sha256}`;
}

function documentsPrefixOfOrg(org: string): string {
  return `${streamPrefixOfOrg({ org })}${connectionDocumentsKind}/`;
}

export function documentStreamOfOrg(org: string, sha256: string): string {
  return `${documentsPrefixOfOrg(org)}${sha256}`;
}

export function isConnectionDocumentStreamOfOrg(org: string, stream: string): boolean {
  const prefix = documentsPrefixOfOrg(org);
  return stream.startsWith(prefix) && aFingerprint.test(stream.slice(prefix.length));
}

const KeptTextSchema = Schema.Struct({ text: Schema.String, sha256: Schema.String, bytes: Schema.Int });

export type KeptText = typeof KeptTextSchema.Type;

export const ConnectionDocumentEventSchema = Schema.Union([
  factOf('connection_document_kept', KeptTextSchema, ActedContextSchema),
]);

type ConnectionDocumentEvent = typeof ConnectionDocumentEventSchema.Type;

export interface DocumentKeeping extends CommandMetadata {
  readonly text: string;
}

export function keptTextOf(text: string): KeptText {
  return { text, sha256: sha256Of(text), bytes: bytesOfText(text) };
}

function decideKeeping(
  { text }: DocumentKeeping,
  kept: KeptText | undefined,
): Result.Result<readonly Decided<ConnectionDocumentEvent>[]> {
  return Result.succeed(kept === undefined ? [{ type: 'connection_document_kept', data: keptTextOf(text) }] : []);
}

function firstKept(kept: KeptText | undefined, { data }: ConnectionDocumentEvent): KeptText {
  return kept ?? data;
}

export const documentFold: Fold<KeptText | undefined, ConnectionDocumentEvent> = {
  initialState: undefined,
  evolve: firstKept,
  eventSchema: ConnectionDocumentEventSchema,
};

export const documentDecider: Decider<KeptText | undefined, DocumentKeeping, ConnectionDocumentEvent> = {
  ...documentFold,
  decide: decideKeeping,
  context: ({ by, at }): Context => ({ by, at }),
};
