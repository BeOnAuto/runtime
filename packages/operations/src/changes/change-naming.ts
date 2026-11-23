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
  readonly playbook?: string;
}

export interface ChangedFact extends PlacedFact {
  readonly data: unknown;
}

export type ResourceChange = { readonly kind: string } & Readonly<Record<string, string>>;

export type ChangeReader = Pick<CallerIdentity, 'permissions' | 'playbooks'>;

interface ReadBy<Field extends string> {
  readonly permittedBy?: readonly Permission[];
  readonly playbook?: Field;
}

export interface ChangeKind<Field extends string = string> {
  readonly kind: string;
  readonly description: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly readBy: ReadBy<string>;
  readonly schema: Schema.Codec<unknown>;
  readonly of: (identity: Readonly<Record<Field, string>>) => ResourceChange;
  readonly readableBy: (reader: ChangeReader, change: ResourceChange) => boolean;
  readonly acrossTheOrg?: ChangeKind;
}

export interface KindShape<Field extends string> extends ReadBy<Field> {
  readonly optional?: readonly Field[];
  readonly acrossTheOrg?: ChangeKind;
}

function readableUnder<Field extends string>(
  { permittedBy, playbook }: ReadBy<Field>,
  optional: readonly string[],
): ChangeKind['readableBy'] {
  return ({ permissions, playbooks }, change) =>
    (permittedBy === undefined || permittedBy.some((permission) => permissions.includes(permission))) &&
    (playbook === undefined ||
      (optional.includes(playbook) && change[playbook] === undefined) ||
      canAccessPlaybook(playbooks, change[playbook]));
}

export function changeKindOf<const Field extends string>(
  kind: string,
  description: string,
  fields: Readonly<Record<Field, string>>,
  { optional = [], acrossTheOrg, ...readBy }: KindShape<NoInfer<Field>> = {},
): ChangeKind<Field> {
  const identity = Object.entries<string>(fields).map(([field, said]: readonly [string, string]) => {
    const described = Schema.String.annotate({ description: said });
    return [field, optional.some((each) => each === field) ? Schema.optionalKey(described) : described] as const;
  });
  const schema = Schema.Struct({
    kind: Schema.Literal(kind).annotate({ description: 'The kind of the resource that changed' }),
    ...Object.fromEntries(identity),
  }).annotate({ description });
  return {
    kind,
    description,
    fields,
    readBy,
    schema,
    of: (named) => ({ kind, ...named }),
    readableBy: readableUnder(readBy, optional),
    ...(acrossTheOrg === undefined ? {} : { acrossTheOrg }),
  };
}

const playbookItIsIn = 'The id of the playbook it is in';

const widened = new WeakMap<ChangeKind, ChangeKind>();

function widenedOf(kind: ChangeKind): ChangeKind {
  return changeKindOf(
    kind.kind,
    kind.description,
    { ...kind.fields, playbook: playbookItIsIn },
    { permittedBy: kind.readBy.permittedBy ?? ['playbook:read'], playbook: 'playbook' },
  );
}

export function acrossTheOrgOf(kind: ChangeKind): ChangeKind {
  if (kind.acrossTheOrg !== undefined) {
    return kind.acrossTheOrg;
  }
  const known = widened.get(kind) ?? widenedOf(kind);
  widened.set(kind, known);
  return known;
}

export const playbookChangedAcrossTheOrg = changeKindOf(
  'playbook',
  'A playbook created, updated, retired or restored, or its own page saved or removed',
  { playbook: 'The id of the playbook' },
  { playbook: 'playbook' },
);

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

export interface StaleOn {
  readonly kind: string;
  readonly keyedBy?: Readonly<Record<string, string>>;
}

export interface StaleRead {
  readonly kind: string;
  readonly playbook?: string;
  readonly key?: Readonly<Record<string, string>>;
}

export interface ReadMade {
  readonly playbook?: string | undefined;
  readonly input: Readonly<Record<string, unknown>>;
}

function keyGiven(
  keyedBy: Readonly<Record<string, string>>,
  input: ReadMade['input'],
): Readonly<Record<string, string>> | undefined {
  const given = Object.entries(keyedBy).map(
    ([field, from]: readonly [string, string]) => [field, input[from]] as const,
  );
  return given.every((pair): pair is readonly [string, string] => typeof pair[1] === 'string')
    ? Object.fromEntries(given)
    : undefined;
}

export function staleReadsOf(
  staleOn: readonly StaleOn[] | undefined,
  { playbook, input }: ReadMade,
): readonly StaleRead[] {
  return (staleOn ?? []).map(({ kind, keyedBy }): StaleRead => {
    const key = keyedBy === undefined ? undefined : keyGiven(keyedBy, input);
    const read: { kind: string; playbook?: string; key?: Readonly<Record<string, string>> } = { kind };
    if (playbook !== undefined) read.playbook = playbook;
    if (key !== undefined) read.key = key;
    return read;
  });
}
