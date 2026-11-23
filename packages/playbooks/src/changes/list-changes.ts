import {
  Caller,
  OrgReader,
  PlaybookReader,
  changeCatalogAcrossTheOrgOf,
  changeCatalogOf,
  defineHttpOperation,
  PlaybookAccessSchema,
  presentedChangeCatalogOf,
  type ChangeCatalog,
  type ChangedFact,
  type ChangeNaming,
  type Presenter,
} from '@on.auto/operations';
import { listed } from '@on.auto/phrasing';
import { Effect, Schema } from 'effect';

import {
  ChangesInputSchema,
  changesOutputSchemaOf,
  factsReadAtOnce,
  heldChanges,
  type ChangesInput,
} from './held-changes.ts';

const theHold = [
  'Without since it answers at once with the cursor of now and no changes, so a client starts from now.',
  'With since it answers at once when something changed after it, and otherwise holds the request until the next change or until wait seconds pass.',
  'Each change names a resource and its identity alone; the client reads what it needs of it.',
  'more says more changed already, so the client asks again at once with the new cursor.',
].join(' ');

function changedIn({ kinds }: ChangeCatalog<ChangedFact>): string {
  return listed(kinds.map(({ kind }) => `${kind}s`));
}

export interface ChangesOfThePlaybooks {
  readonly presenters: readonly Presenter[];
  readonly namings: readonly ChangeNaming[];
}

const acrossThePlaybooks = 'org_and_playbooks';

const OrgChangesInputSchema = Schema.Struct({
  ...ChangesInputSchema.fields,
  scope: Schema.optionalKey(
    Schema.Literals(['org', acrossThePlaybooks]).annotate({
      description: `What the changes are of: org, the org's own resources, when left out; ${acrossThePlaybooks}, those and everything inside each playbook of the org the caller may read, each change of a playbook naming its playbook`,
    }),
  ),
});

function orgChangesOutputSchemaOf(
  { kinds: [first, ...others] }: ChangeCatalog<ChangedFact>,
  across: ChangeCatalog<ChangedFact> | undefined,
) {
  const owned = new Set([first, ...others]);
  const answered = changesOutputSchemaOf({
    kinds: [first, ...others, ...(across?.kinds ?? []).filter((kind) => !owned.has(kind))],
  });
  return Schema.Struct({
    ...answered.fields,
    playbooks: Schema.optionalKey(
      PlaybookAccessSchema.annotate({
        description: `With the scope ${acrossThePlaybooks}, the playbooks the caller may read now: * for every one, or their ids; a playbook the caller read before and that is no longer listed is one it lost access to`,
      }),
    ),
  });
}

function ownScopeOf(catalog: ChangeCatalog<ChangedFact>) {
  const read = { most: factsReadAtOnce, dataOf: catalog.namedTypes };
  return (input: ChangesInput) =>
    Effect.gen(function* () {
      const reader = yield* OrgReader;
      const caller = yield* Caller;
      return yield* heldChanges(catalog, {
        readable: catalog.readableBy(caller),
        read: (after) => reader.readAppendedFacts(catalog.streamKinds, after === undefined ? read : { ...read, after }),
        waited: (after, deadline) => reader.waitForAppend(catalog.streamKinds, after, deadline),
      })(input);
    });
}

function acrossTheScopeOf(whole: ChangeCatalog<ChangedFact>) {
  const read = { most: factsReadAtOnce, dataOf: whole.namedTypes };
  return (input: ChangesInput) =>
    Effect.gen(function* () {
      const reader = yield* OrgReader;
      const caller = yield* Caller;
      const answer = yield* heldChanges(whole, {
        readable: whole.readableBy(caller),
        read: (after) =>
          reader.readAppendedFactsAcrossTheOrg(whole.streamKinds, after === undefined ? read : { ...read, after }),
        waited: (after, deadline) => reader.waitForAppendAcrossTheOrg(whole.streamKinds, after, deadline),
      })(input);
      return { ...answer, playbooks: caller.playbooks };
    });
}

type OrgChangesInput = ChangesInput & { readonly scope?: 'org' | typeof acrossThePlaybooks };

export function defineListOrgChanges(
  namings: readonly ChangeNaming<ChangedFact>[],
  ofThePlaybooks?: ChangesOfThePlaybooks,
) {
  const catalog = changeCatalogOf(namings);
  const across =
    ofThePlaybooks === undefined
      ? undefined
      : changeCatalogAcrossTheOrgOf<ChangedFact>(namings, [...ofThePlaybooks.presenters, ...ofThePlaybooks.namings]);
  const ownScope = ownScopeOf(catalog);
  const acrossTheScope = across === undefined ? ownScope : acrossTheScopeOf(across);
  return defineHttpOperation('org', 'query', {
    name: 'list_org_changes',
    title: 'List org changes',
    description: `Answers which ${changedIn(catalog)} of the org changed after a cursor, of those the caller may read. ${theHold}`,
    route: { method: 'GET', path: '/changes' },
    permittedBy: ['org:read', 'playbook:read'],
    body: { kind: 'none' },
    inputSchema: across === undefined ? ChangesInputSchema : OrgChangesInputSchema,
    outputSchema: orgChangesOutputSchemaOf(catalog, across),
    reasons: ['invalid_input'],
    handle: ({ scope, ...input }: OrgChangesInput) =>
      scope === acrossThePlaybooks ? acrossTheScope(input) : ownScope(input),
  });
}

export function defineListPlaybookChanges(presenters: readonly Presenter[], namings: readonly ChangeNaming[] = []) {
  const catalog = presentedChangeCatalogOf(presenters, namings);
  const read = { most: factsReadAtOnce, dataOf: [] };
  return defineHttpOperation('playbook', 'query', {
    name: 'list_playbook_changes',
    title: 'List playbook changes',
    description: `Answers which ${changedIn(catalog)} of the playbook changed after a cursor. ${theHold}`,
    route: { method: 'GET', path: '/changes' },
    body: { kind: 'none' },
    inputSchema: ChangesInputSchema,
    outputSchema: changesOutputSchemaOf(catalog),
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
