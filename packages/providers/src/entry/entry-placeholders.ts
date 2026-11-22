import { placeholderNamePattern } from '@on.auto/config';
import type { Schema } from 'effect';

import { holdsAClientId, waysHoldingAClientId, type WayKind } from './credential-ways.ts';
import { clientIdPlaceholder, isRequired, setNamesOfEach, type Placeholder } from './placeholders.ts';
import { namesIn, templatedFieldsOf, type TemplatedField, type WayParts } from './templates.ts';

type Placeholders = Readonly<Record<string, Placeholder>>;

interface TemplatedWay extends WayParts {
  readonly kind: WayKind;
  readonly placeholders?: Placeholders;
}

interface Templated {
  readonly url?: string;
  readonly document?: string;
  readonly base_url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query_params?: Readonly<Record<string, string>>;
  readonly placeholders?: Placeholders;
  readonly credentials: readonly TemplatedWay[];
}

type EntryIssue = Schema.FilterIssue;

const clientIdElsewhere = `Holds {client_id}, which only a header or query value of a provider whose every way is ${waysHoldingAClientId} holds`;

const unusedByTheProvider =
  'Expected the placeholder in the address, a header or a query value of the provider, since nothing else takes it';

const unusedByTheWay = "Expected the placeholder in this way's addresses or its base_url, since nothing else takes it";

const namedAsTheProviders =
  "Expected a name no placeholder of the provider has, since a way's placeholder is asked beside the provider's";

const besideAWayOfItsKind =
  "Expected no placeholders on a way whose kind another way of the provider has, since a connection is added by the kind of its way alone, and this way's values could not be asked";

interface Names {
  readonly declared: readonly string[];
  readonly setting: readonly string[];
  readonly set: readonly string[];
  readonly clientIdPlaced: boolean;
}

interface Scope {
  readonly placeholders: Placeholders;
  readonly own: Placeholders;
  readonly fields: readonly TemplatedField[];
  readonly used: ReadonlySet<string>;
  readonly path: readonly string[];
  readonly unused: string;
}

function usedIn(fields: readonly TemplatedField[]): ReadonlySet<string> {
  return new Set(fields.flatMap(({ text }) => namesIn(text)));
}

function scopesOf(entry: Templated): readonly Scope[] {
  const { placeholders = {}, credentials } = entry;
  const fields = templatedFieldsOf(entry);
  return [
    {
      placeholders,
      own: placeholders,
      fields: fields.filter(({ way }) => way === undefined),
      used: usedIn(fields),
      path: ['placeholders'],
      unused: unusedByTheProvider,
    },
    ...credentials.map((way, index) => {
      const ofTheWay = fields.filter((field) => field.way === index);
      return {
        placeholders: { ...placeholders, ...way.placeholders },
        own: way.placeholders ?? {},
        fields: ofTheWay,
        used: usedIn(ofTheWay),
        path: ['credentials', String(index), 'placeholders'],
        unused: unusedByTheWay,
      };
    }),
  ];
}

function namesOf({ placeholders }: Scope, clientIdPlaced: boolean): Names {
  return {
    declared: Object.keys(placeholders),
    setting: Object.entries(placeholders)
      .filter(([, placeholder]: readonly [string, Placeholder]) => setNamesOfEach({ placeholder }).length > 0)
      .map(([name]: readonly [string, Placeholder]) => name),
    set: setNamesOfEach(placeholders),
    clientIdPlaced,
  };
}

function holdsClientIdWords(field: TemplatedField, names: Names): string {
  return field.holds === 'value' && names.clientIdPlaced ? '' : clientIdElsewhere;
}

function undeclaredIssueOf(field: TemplatedField, name: string, ofWays: ReadonlySet<string>): string {
  if (!ofWays.has(name)) {
    return `Holds {${name}}, which no placeholder of the provider and no choice of one gives`;
  }
  return field.way === undefined
    ? `Holds {${name}}, the placeholder of a way, which only that way's addresses and base_url hold, since it is asked only when that way is chosen`
    : `Holds {${name}}, the placeholder of another way, which this way does not ask`;
}

function unknownIssueOf(field: TemplatedField, name: string, names: Names, ofWays: ReadonlySet<string>): string {
  if (name === clientIdPlaceholder) {
    return holdsClientIdWords(field, names);
  }
  return names.declared.includes(name) || names.set.includes(name) ? '' : undeclaredIssueOf(field, name, ofWays);
}

function unknownIssuesOf(fields: readonly TemplatedField[], names: Names, ofWays: ReadonlySet<string>) {
  return fields.flatMap((field) =>
    namesIn(field.text)
      .map((name) => unknownIssueOf(field, name, names, ofWays))
      .filter((issue) => issue !== '')
      .map((issue): EntryIssue => ({ path: field.path, issue })),
  );
}

function unusedIssuesOf({ own, used, path, unused }: Scope, names: Names): readonly EntryIssue[] {
  return [
    ...Object.keys(own)
      .filter((name) => !used.has(name) && !names.setting.includes(name))
      .map((name) => ({ path: [...path, name], issue: unused })),
    ...setNamesOfEach(own)
      .filter((name) => !used.has(name) || names.declared.includes(name))
      .map((name) => ({
        path,
        issue: `Expected ${name}, which a choice sets, in the address, a header or a query value, and never among the placeholders`,
      })),
  ];
}

function optionalIssuesOf({ placeholders, fields }: Scope): readonly EntryIssue[] {
  const optional = new Set(
    Object.entries(placeholders)
      .filter(([, placeholder]: readonly [string, Placeholder]) => !isRequired(placeholder))
      .map(([name]: readonly [string, Placeholder]) => name),
  );
  return fields.flatMap((field) =>
    namesIn(field.text)
      .filter((name) => optional.has(name) && (field.holds !== 'value' || field.text !== `{${name}}`))
      .map((name) => ({
        path: field.path,
        issue: `Holds the optional placeholder {${name}}, which stands only as the whole value of a header or a query parameter, left out where it is not given`,
      })),
  );
}

interface Named {
  readonly name: string;
  readonly path: readonly string[];
}

function nameIssueOf(name: string): string | undefined {
  if (name === clientIdPlaceholder) {
    return `Expected another name: {client_id} is the client id of a ${waysHoldingAClientId} way, never asked`;
  }
  return placeholderNamePattern.test(name)
    ? undefined
    : 'Expected the name of a placeholder: a lowercase letter, then lowercase letters, digits and underscores';
}

function nameIssuesOf({ own, path }: Scope): readonly EntryIssue[] {
  const named: readonly Named[] = [
    ...Object.keys(own).map((name) => ({ name, path: [...path, name] })),
    ...Object.entries(own).flatMap(([owner, { choices = [] }]: readonly [string, Placeholder]) =>
      choices.flatMap(({ sets = {} }, index) =>
        Object.keys(sets).map((name) => ({ name, path: [...path, owner, 'choices', String(index), 'sets', name] })),
      ),
    ),
  ];
  return named.flatMap(({ name, path: at }: Named) => {
    const issue = nameIssueOf(name);
    return issue === undefined ? [] : [{ path: at, issue }];
  });
}

function ownedIssuesOf({ placeholders = {}, credentials }: Templated): readonly EntryIssue[] {
  return credentials.flatMap((way, index): readonly EntryIssue[] => {
    const own = Object.keys(way.placeholders ?? {});
    const path = ['credentials', String(index), 'placeholders'];
    const ofItsKind = credentials.filter(({ kind }) => kind === way.kind).length > 1;
    return [
      ...own
        .filter((name) => Object.hasOwn(placeholders, name))
        .map((name) => ({
          path: [...path, name],
          issue: namedAsTheProviders,
        })),
      ...(own.length > 0 && ofItsKind ? [{ path, issue: besideAWayOfItsKind }] : []),
    ];
  });
}

function ofTheWays({ credentials }: Templated): ReadonlySet<string> {
  return new Set(
    credentials.flatMap(({ placeholders = {} }) => [...Object.keys(placeholders), ...setNamesOfEach(placeholders)]),
  );
}

function scopeIssuesOf(scope: Scope, clientIdPlaced: boolean, ofWays: ReadonlySet<string>): readonly EntryIssue[] {
  const names = namesOf(scope, clientIdPlaced);
  return [
    ...nameIssuesOf(scope),
    ...unknownIssuesOf(scope.fields, names, ofWays),
    ...unusedIssuesOf(scope, names),
    ...optionalIssuesOf(scope),
  ];
}

export function placementIssuesOf(entry: Templated): readonly EntryIssue[] {
  const clientIdPlaced = entry.credentials.every(({ kind }) => holdsAClientId(kind));
  const ofWays = ofTheWays(entry);
  return [...ownedIssuesOf(entry), ...scopesOf(entry).flatMap((scope) => scopeIssuesOf(scope, clientIdPlaced, ofWays))];
}
