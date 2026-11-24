import type { OrgReader } from '@on.auto/operations';
import { isConnectionServerSettings, type ConnectionServerSettings } from '@on.auto/tool-servers';
import { Effect, Option, Redacted, Result } from 'effect';

import { readableDocumentText } from '../documents/kept-documents.ts';
import { readAddition, type EntryChecking } from '../entries/entry-checks.ts';
import type { Given } from '../entries/given-values.ts';
import type { RecordedConnection } from '../registry/connection.ts';

export function settingsGivenOf(
  connection: RecordedConnection,
  { value, algorithm, clientId }: Given,
  checking: EntryChecking,
): Effect.Effect<ConnectionServerSettings, never, OrgReader> {
  return Effect.gen(function* () {
    const { document } = connection;
    const documentText = document === undefined ? undefined : yield* readableDocumentText(document);
    const heldOrGiven = Option.getOrThrow(Option.fromNullishOr(clientId ?? connection.credential.client_id));
    const credential = { ...connection.credential, client_id: heldOrGiven };
    const read = readAddition({ ...connection, credential, documentText }, checking, {
      value: Redacted.make(value),
      algorithm,
    });
    return Option.getOrThrow(Option.liftPredicate(Result.getOrThrow(read), isConnectionServerSettings));
  });
}
