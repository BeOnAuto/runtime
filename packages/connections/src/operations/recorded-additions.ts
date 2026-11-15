import type { ProviderList } from '@on.auto/providers';
import { Effect } from 'effect';

import { keepDocument } from '../documents/kept-documents.ts';
import type { DescribedAddition } from '../entries/described-entries.ts';
import { additionRefusalOf } from '../registry/registry-decisions.ts';
import type { OpenLink } from '../registry/registry.ts';
import { additionOf, loadRegistry, recordInRegistry, recordedCaller } from './registry-access.ts';

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

export const recordedAdditionOf = Effect.fnUntraced(function* (named: Named, given: DescribedAddition, link: OpenLink) {
  yield* documentKeptFor(named, given);
  const addition = additionOf(given, link, yield* recordedCaller);
  return yield* recordInRegistry(named, addition).pipe(
    Effect.catchTags({ not_found: Effect.die, forbidden: Effect.die, invalid_input: Effect.die }),
  );
});
