import { Effect } from 'effect';

import { keepDocument } from '../documents/kept-documents.ts';
import type { DescribedAddition } from '../entries/described-entries.ts';
import { additionRefusalOf } from '../registry/registry-decisions.ts';
import type { OpenLink } from '../registry/registry.ts';
import { additionOf, loadRegistry, recordInRegistry, recordedCaller } from './registry-access.ts';

const documentKeptUnlessRefused = Effect.fnUntraced(function* (name: string, text: string) {
  const refusal = additionRefusalOf(name, yield* loadRegistry);
  if (refusal !== undefined) {
    return yield* Effect.fail(refusal);
  }
  return yield* keepDocument(text);
});

function documentKeptFor({ name, documentText }: DescribedAddition) {
  return documentText === undefined ? Effect.void : documentKeptUnlessRefused(name, documentText);
}

export const recordedAdditionOf = Effect.fnUntraced(function* (given: DescribedAddition, link: OpenLink) {
  yield* documentKeptFor(given);
  const addition = additionOf(given, link, yield* recordedCaller);
  return yield* recordInRegistry(addition).pipe(
    Effect.catchTags({ not_found: Effect.die, forbidden: Effect.die, invalid_input: Effect.die }),
  );
});
