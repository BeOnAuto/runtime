import type { Schema } from 'effect';

import { holdsAClientId, waysHoldingAClientId, type WayKind } from './credential-ways.ts';
import { clientIdPlaceholder, isRequired, nameIssueOf, setNamesOfEach, type Placeholder } from './placeholders.ts';
import { namesIn, templatedFieldsOf, type TemplatedField } from './templates.ts';

interface Templated {
  readonly url?: string;
  readonly document?: string;
  readonly base_url?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly query_params?: Readonly<Record<string, string>>;
  readonly placeholders?: Readonly<Record<string, Placeholder>>;
  readonly credentials: readonly { readonly kind: WayKind; readonly issuer?: string }[];
}

type EntryIssue = Schema.FilterIssue;

const clientIdElsewhere = `Holds {client_id}, which only a header or query value of a provider whose every way is ${waysHoldingAClientId} holds`;

interface Names {
  readonly declared: readonly string[];
  readonly setting: readonly string[];
  readonly set: readonly string[];
  readonly clientIdPlaced: boolean;
}

function namesOf({ placeholders = {}, credentials }: Templated): Names {
  return {
    declared: Object.keys(placeholders),
    setting: Object.entries(placeholders)
      .filter(([, placeholder]: readonly [string, Placeholder]) => setNamesOfEach({ placeholder }).length > 0)
      .map(([name]: readonly [string, Placeholder]) => name),
    set: setNamesOfEach(placeholders),
    clientIdPlaced: credentials.every(({ kind }) => holdsAClientId(kind)),
  };
}

function holdsClientIdWords(field: TemplatedField, names: Names): string {
  return field.holds === 'value' && names.clientIdPlaced ? '' : clientIdElsewhere;
}

function unknownIssueOf(field: TemplatedField, name: string, names: Names): string {
  if (name === clientIdPlaceholder) {
    return holdsClientIdWords(field, names);
  }
  return names.declared.includes(name) || names.set.includes(name)
    ? ''
    : `Holds {${name}}, which no placeholder of the provider and no choice of one gives`;
}

function unknownIssuesOf(fields: readonly TemplatedField[], names: Names): readonly EntryIssue[] {
  return fields.flatMap((field) =>
    namesIn(field.text)
      .map((name) => unknownIssueOf(field, name, names))
      .filter((issue) => issue !== '')
      .map((issue) => ({ path: field.path, issue })),
  );
}

function unusedIssuesOf(fields: readonly TemplatedField[], names: Names): readonly EntryIssue[] {
  const used = new Set(fields.flatMap(({ text }) => namesIn(text)));
  return [
    ...names.declared
      .filter((name) => !used.has(name) && !names.setting.includes(name))
      .map((name) => ({
        path: ['placeholders', name],
        issue:
          'Expected the placeholder in the address, a header or a query value of the provider, since nothing else takes it',
      })),
    ...names.set
      .filter((name) => !used.has(name) || names.declared.includes(name))
      .map((name) => ({
        path: ['placeholders'],
        issue: `Expected ${name}, which a choice sets, in the address, a header or a query value, and never among the placeholders`,
      })),
  ];
}

function optionalNamesOf({ placeholders = {} }: Templated): readonly string[] {
  return Object.entries(placeholders)
    .filter(([, placeholder]: readonly [string, Placeholder]) => !isRequired(placeholder))
    .map(([name]: readonly [string, Placeholder]) => name);
}

function optionalIssuesOf(fields: readonly TemplatedField[], optional: readonly string[]): readonly EntryIssue[] {
  return fields.flatMap((field) =>
    namesIn(field.text)
      .filter((name) => optional.includes(name) && (field.holds !== 'value' || field.text !== `{${name}}`))
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

function nameIssuesOf({ placeholders = {} }: Templated): readonly EntryIssue[] {
  const named: readonly Named[] = [
    ...Object.keys(placeholders).map((name) => ({ name, path: ['placeholders', name] })),
    ...Object.entries(placeholders).flatMap(([owner, { choices = [] }]: readonly [string, Placeholder]) =>
      choices.flatMap(({ sets = {} }, index) =>
        Object.keys(sets).map((name) => ({
          name,
          path: ['placeholders', owner, 'choices', String(index), 'sets', name],
        })),
      ),
    ),
  ];
  return named.flatMap(({ name, path }: Named) => {
    const issue = nameIssueOf(name);
    return issue === undefined ? [] : [{ path, issue }];
  });
}

export function placementIssuesOf(entry: Templated): readonly EntryIssue[] {
  const fields = templatedFieldsOf(entry);
  const names = namesOf(entry);
  return [
    ...nameIssuesOf(entry),
    ...unknownIssuesOf(fields, names),
    ...unusedIssuesOf(fields, names),
    ...optionalIssuesOf(fields, optionalNamesOf(entry)),
  ];
}
