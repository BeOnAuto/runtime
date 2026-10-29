import {
  Caller,
  listed,
  OrgReader,
  PlaybookReader,
  changeCatalogOf,
  defineHttpOperation,
  presentedChangeCatalogOf,
  type ChangeCatalog,
  type ChangedFact,
  type ChangeNaming,
  type Presenter,
} from '@on.auto/operations';
import { Effect } from 'effect';

import { ChangesInputSchema, changesOutputSchemaOf, factsReadAtOnce, heldChanges } from './held-changes.ts';

const theHold = [
  'Without since it answers at once with the cursor of now and no changes, so a client starts from now.',
  'With since it answers at once when something changed after it, and otherwise holds the request until the next change or until wait seconds pass.',
  'Each change names a resource and its identity alone; the client reads what it needs of it.',
  'more says more changed already, so the client asks again at once with the new cursor.',
].join(' ');

function changedIn({ kinds }: ChangeCatalog<ChangedFact>): string {
  return listed(kinds.map(({ kind }) => `${kind}s`));
}

export function defineListOrgChanges(namings: readonly ChangeNaming<ChangedFact>[]) {
  const catalog = changeCatalogOf(namings);
  const read = { most: factsReadAtOnce, dataOf: catalog.namedTypes };
  return defineHttpOperation('org', 'query', {
    name: 'list_org_changes',
    title: 'List org changes',
    description: `Answers which ${changedIn(catalog)} of the org changed after a cursor, of those the caller may read. ${theHold}`,
    route: { method: 'GET', path: '/changes' },
    permittedBy: ['org:read', 'playbook:read'],
    body: { kind: 'none' },
    inputSchema: ChangesInputSchema,
    answer: { kind: 'json', outputSchema: changesOutputSchemaOf(catalog) },
    reasons: ['invalid_input'],
    handle: (input) =>
      Effect.gen(function* () {
        const reader = yield* OrgReader;
        const caller = yield* Caller;
        return yield* heldChanges(catalog, {
          readable: catalog.readableBy(caller),
          read: (after) =>
            reader.readAppendedFacts(catalog.streamKinds, after === undefined ? read : { ...read, after }),
          waited: (after, deadline) => reader.waitForAppend(catalog.streamKinds, after, deadline),
        })(input);
      }),
  });
}

export function defineListPlaybookChanges(presenters: readonly Presenter[]) {
  const catalog = presentedChangeCatalogOf(presenters);
  const read = { most: factsReadAtOnce, dataOf: [] };
  return defineHttpOperation('playbook', 'query', {
    name: 'list_playbook_changes',
    title: 'List playbook changes',
    description: `Answers which ${changedIn(catalog)} of the playbook changed after a cursor. ${theHold}`,
    route: { method: 'GET', path: '/changes' },
    body: { kind: 'none' },
    inputSchema: ChangesInputSchema,
    answer: { kind: 'json', outputSchema: changesOutputSchemaOf(catalog) },
    reasons: ['invalid_input'],
    handle: (input) =>
      Effect.gen(function* () {
        const reader = yield* PlaybookReader;
        const caller = yield* Caller;
        return yield* heldChanges(catalog, {
          readable: catalog.readableBy(caller),
          read: (after) => reader.readAppendedFacts(after === undefined ? read : { ...read, after }),
          waited: (after, deadline) => reader.waitForAppend(after, deadline),
        })(input);
      }),
  });
}
