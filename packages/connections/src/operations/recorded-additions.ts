import type { RecordedCaller } from '@on.auto/operations';
import type { ProviderList } from '@on.auto/providers';
import { Effect } from 'effect';

import { keepDocument } from '../documents/kept-documents.ts';
import type { DescribedAddition } from '../entries/described-entries.ts';
import type { ConnectionAddition, ConnectionRequest } from '../registry/connection-commands.ts';
import { additionRefusalOf } from '../registry/registry-decisions.ts';
import type { OpenLink } from '../registry/registry.ts';
import { additionOf, loadRegistry, recordInRegistry, recordedCaller, requestOf } from './registry-access.ts';

interface Named {
  readonly providers: ProviderList;
}

const documentKeptUnlessRefused = Effect.fnUntraced(function* (named: Named, name: string, text: string) {
  const refusal = additionRefusalOf(name, yield* loadRegistry(named));
  if (refusal !== undefined) {
    return yield* Effect.fail(refusal);
  }
  return yield* keepDocument(text);
});

function documentKeptFor(named: Named, { name, documentText }: DescribedAddition) {
  return documentText === undefined ? Effect.void : documentKeptUnlessRefused(named, name, documentText);
}

const recordedWithItsDocument = Effect.fnUntraced(function* (
  named: Named,
  given: DescribedAddition,
  recorded: (addedBy: RecordedCaller) => ConnectionAddition | ConnectionRequest,
) {
  yield* documentKeptFor(named, given);
  return yield* recordInRegistry(named, recorded(yield* recordedCaller)).pipe(
    Effect.catchTags({ not_found: Effect.die, forbidden: Effect.die, invalid_input: Effect.die }),
  );
});

export function recordedAdditionOf(named: Named, given: DescribedAddition, link: OpenLink) {
  return recordedWithItsDocument(named, given, (addedBy) => additionOf(given, link, addedBy));
}

export function recordedRequestOf(named: Named, given: DescribedAddition, message: string | undefined) {
  return recordedWithItsDocument(named, given, (addedBy) => requestOf(given, message, addedBy));
}
