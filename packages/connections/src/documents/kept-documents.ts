import { Caller, OrgReader, OrgWriter, type StreamReader } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import type { ConnectionDocument } from '../registry/connection-entry.ts';
import {
  documentDecider,
  documentFold,
  documentStreamOf,
  documentStreamOfOrg,
  keptTextOf,
  type KeptText,
} from './document-streams.ts';

export const keepDocument = Effect.fnUntraced(function* (text: string) {
  const { id: by } = yield* Caller;
  const at = DateTime.formatIso(yield* DateTime.now);
  const stream = documentStreamOf(keptTextOf(text).sha256);
  yield* (yield* OrgWriter).execute(stream, documentDecider, { text, by, at });
});

export interface DocumentNamed {
  readonly name: string;
  readonly document: ConnectionDocument;
}

const documentWords = {
  missing: (name: string) => `The OpenAPI document the connection ${name} was added with is not kept`,
  mismatching: (name: string) =>
    `The OpenAPI document kept for the connection ${name} is not the one it was added with`,
};

function isTheDocumentOf({ text }: KeptText, { sha256, bytes }: ConnectionDocument): boolean {
  const read = keptTextOf(text);
  return read.sha256 === sha256 && read.bytes === bytes;
}

function textOf(kept: KeptText | undefined, { name, document }: DocumentNamed): Effect.Effect<string> {
  if (kept === undefined) {
    return Effect.die(new Error(documentWords.missing(name)));
  }
  return isTheDocumentOf(kept, document)
    ? Effect.succeed(kept.text)
    : Effect.die(new Error(documentWords.mismatching(name)));
}

export function documentTextOf(registry: StreamReader, org: string, named: DocumentNamed): Effect.Effect<string> {
  return Effect.flatMap(registry.load(documentStreamOfOrg(org, named.document.sha256), documentFold), ({ state }) =>
    textOf(state, named),
  );
}

export const readableDocumentText = Effect.fnUntraced(function* (document: ConnectionDocument) {
  const { state } = yield* (yield* OrgReader).load(documentStreamOf(document.sha256), documentFold);
  return state !== undefined && isTheDocumentOf(state, document) ? state.text : undefined;
});
