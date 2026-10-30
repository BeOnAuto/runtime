import { Schema } from 'effect';

import type { CallerIdentity } from '../caller/caller.ts';
import type { Permission } from '../caller/permission.ts';
import { canAccessPlaybook } from '../caller/playbook-access.ts';
import type { Context } from '../ledger/context.ts';

export interface PlacedFact {
  readonly id: string;
  readonly stream: string;
  readonly type: string;
  readonly context: Context;
}

export interface ChangedFact extends PlacedFact {
  readonly data: unknown;
}

export type ResourceChange = { readonly kind: string } & Readonly<Record<string, string>>;

export type ChangeReader = Pick<CallerIdentity, 'permissions' | 'playbooks'>;

export interface ReadBy<Field extends string> {
  readonly permittedBy?: readonly Permission[];
  readonly playbook?: Field;
}

export interface ChangeKind<Field extends string = string> {
  readonly kind: string;
  readonly schema: Schema.Codec<unknown>;
  readonly of: (identity: Readonly<Record<Field, string>>) => ResourceChange;
  readonly readableBy: (reader: ChangeReader, change: ResourceChange) => boolean;
}

function readableUnder<Field extends string>({ permittedBy, playbook }: ReadBy<Field>): ChangeKind['readableBy'] {
  return ({ permissions, playbooks }, change) =>
    (permittedBy === undefined || permittedBy.some((permission) => permissions.includes(permission))) &&
    (playbook === undefined || canAccessPlaybook(playbooks, change[playbook]));
}

export function changeKindOf<const Field extends string>(
  kind: string,
  description: string,
  fields: Readonly<Record<Field, string>>,
  readBy: ReadBy<NoInfer<Field>> = {},
): ChangeKind<Field> {
  const identity = Object.entries<string>(fields).map(
    ([field, said]: readonly [string, string]) => [field, Schema.String.annotate({ description: said })] as const,
  );
  const schema = Schema.Struct({
    kind: Schema.Literal(kind).annotate({ description: 'The kind of the resource that changed' }),
    ...Object.fromEntries(identity),
  }).annotate({ description });
  return { kind, schema, of: (named) => ({ kind, ...named }), readableBy: readableUnder(readBy) };
}

const eventChanged = changeKindOf('event', 'An event the feed of the playbook lists', {
  event_id: 'The id of the event, as list_playbook_events lists it',
});

export type NameOfChange<Fact extends PlacedFact = PlacedFact> = (fact: Fact) => readonly ResourceChange[];

export interface ChangesNamed<Fact extends PlacedFact = PlacedFact> {
  readonly kinds: readonly ChangeKind[];
  readonly named: Readonly<Record<string, NameOfChange<Fact> | null>>;
}

export interface ChangeNaming<Fact extends PlacedFact = PlacedFact> {
  readonly streamKind: string;
  readonly changes: ChangesNamed<Fact>;
}

export function changingNothing(types: readonly string[]): ChangesNamed {
  return { kinds: [], named: Object.fromEntries(types.map((type) => [type, null])) };
}

export function changingOne<Fact extends PlacedFact>(
  kind: ChangeKind,
  types: readonly string[],
  name: NameOfChange<Fact>,
): ChangesNamed<Fact> {
  return { kinds: [kind], named: Object.fromEntries(types.map((type) => [type, name])) };
}

export function changingEvents(types: readonly string[]): ChangesNamed {
  return changingOne(eventChanged, types, ({ id }) => [eventChanged.of({ event_id: id })]);
}
