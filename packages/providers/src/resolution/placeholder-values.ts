import { credentialProblems, placeholdersReplaced } from '@on.auto/config';
import type { Issue } from '@on.auto/operations';
import { alternatives, listed } from '@on.auto/phrasing';
import { isPinnableUrl, pinnedUrlShape } from '@on.auto/tool-servers';
import { JsonPointer, Option, Result } from 'effect';

import type { CredentialWay } from '../entry/credential-ways.ts';
import {
  isAnAddress,
  isRequired,
  leavesItsValuesToThePage,
  patternOf,
  type Choice,
  type Placeholder,
} from '../entry/placeholders.ts';
import type { ProviderEntry } from '../entry/provider-entry.ts';
import { isAddress, marked, templatedFieldsOf, type TemplatedField } from '../entry/templates.ts';

export interface Values {
  readonly given: ReadonlyMap<string, string>;
  readonly placed: ReadonlyMap<string, string>;
}

type Given = Readonly<Record<string, string>>;

type Placeholders = Readonly<Record<string, Placeholder>>;

type Markers = ReadonlyMap<string, string>;

const heldCredential =
  'Looks like a credential, which a placeholder never holds: the person gives the credential on the page the link opens';

const heldDollar =
  'Holds a $, which a placeholder never holds, since a reference to an environment variable begins with it';

const hostnameCharacters = /^[A-Za-z0-9-]+$/u;

const addressMovers = /[/?#]/u;

function pointerOf(name: string): string {
  return `/placeholders/${JsonPointer.escapeToken(name)}`;
}

function credentialIssueOf(name: string, value: string): string | undefined {
  return credentialProblems(name, value, '', [name]).length > 0 ? heldCredential : undefined;
}

function patternIssueOf(name: string, { pattern, example }: Placeholder, value: string): string | undefined {
  const written = Option.getOrThrow(Option.fromNullishOr(pattern));
  if (!Option.getOrThrow(Option.fromNullishOr(patternOf(written))).test(value)) {
    return `Expected a value that matches ${written}, such as ${Option.getOrThrow(Option.fromNullishOr(example))}`;
  }
  return credentialIssueOf(name, value);
}

function addressIssueOf(name: string, value: string): string | undefined {
  return isPinnableUrl(value) ? credentialIssueOf(name, value) : pinnedUrlShape;
}

function valueIssueOf(name: string, placeholder: Placeholder, value: string): string | undefined {
  const { choices } = placeholder;
  if (value.includes('$')) {
    return heldDollar;
  }
  if (isAnAddress(placeholder)) {
    return addressIssueOf(name, value);
  }
  if (choices === undefined) {
    return patternIssueOf(name, placeholder, value);
  }
  return choices.some((choice) => choice.value === value)
    ? undefined
    : `Expected one of ${alternatives(choices.map((choice) => choice.value))}`;
}

function ofAnotherWay({ credentials }: ProviderEntry, name: string): boolean {
  return credentials.some(({ placeholders = {} }) => Object.hasOwn(placeholders, name));
}

function unknownIssuesOf(entry: ProviderEntry, placeholders: Placeholders, given: Given): readonly Issue[] {
  const declared = Object.keys(placeholders);
  const taken = declared.length === 0 ? 'none' : listed(declared);
  return Object.keys(given)
    .filter((name) => !Object.hasOwn(placeholders, name))
    .map((name) => ({
      pointer: pointerOf(name),
      detail: ofAnotherWay(entry, name)
        ? `The provider ${entry.name} takes ${name} only for another way to connect; this way takes ${taken}`
        : `The provider ${entry.name} has no placeholder ${name}; it takes ${taken}`,
    }));
}

function declaredIssuesOf(placeholders: Placeholders, given: Given): readonly Issue[] {
  return Object.entries(placeholders).flatMap(([name, placeholder]: readonly [string, Placeholder]) => {
    const value = Object.hasOwn(given, name) ? given[name] : undefined;
    if (value === undefined) {
      return isRequired(placeholder)
        ? [{ pointer: pointerOf(name), detail: `Expected ${name}: ${placeholder.description}` }]
        : [];
    }
    const issue = valueIssueOf(name, placeholder, value);
    return issue === undefined ? [] : [{ pointer: pointerOf(name), detail: issue }];
  });
}

function setOfTheChosen(placeholders: Placeholders, given: Given): ReadonlyMap<string, string> {
  const chosen = Object.entries(placeholders).flatMap(([name, { choices = [] }]: readonly [string, Placeholder]) =>
    choices.filter((choice: Choice) => given[name] === choice.value),
  );
  return new Map(chosen.flatMap(({ sets = {} }) => Object.entries(sets)));
}

function positionIssueOf(value: string, inTheHost: boolean): string | undefined {
  if (inTheHost) {
    return hostnameCharacters.test(value)
      ? undefined
      : 'Expected letters, digits and hyphens alone, since the value names a host';
  }
  return addressMovers.test(value) ? 'Expected no /, ? or #, which would move the address' : undefined;
}

function issuesOfEach(names: Iterable<string>, detail: string): readonly Issue[] {
  return [...new Set(names)].map((name) => ({ pointer: pointerOf(name), detail }));
}

function roundTripIssuesOf(template: string, markedText: string, markers: Markers, values: Values): readonly Issue[] {
  const parsed = new URL(markedText);
  const shown = (marker: string, name: string): string => {
    const value = Option.getOrThrow(Option.fromNullishOr(values.given.get(name)));
    return parsed.hostname.includes(marker) ? value.toLowerCase() : value;
  };
  const expected = [...markers].reduce(
    (href, [marker, name]: readonly [string, string]) => href.replaceAll(marker, shown(marker, name)),
    parsed.href,
  );
  return new URL(placedText(template, values)).href === expected
    ? []
    : issuesOfEach(
        markers.values(),
        'Expected a value the address keeps as it is written, which the reading of this URL changes',
      );
}

function fieldIssuesOf({ text: template }: TemplatedField, values: Values): readonly Issue[] {
  const { text, markers } = marked(template, (name) => values.placed.get(name));
  const { hostname } = new URL(text);
  const positioned = [...markers].flatMap(([marker, name]: readonly [string, string]) => {
    const issue = positionIssueOf(
      Option.getOrThrow(Option.fromNullishOr(values.given.get(name))),
      hostname.includes(marker),
    );
    return issue === undefined ? [] : [{ pointer: pointerOf(name), detail: issue }];
  });
  return positioned.length > 0 ? positioned : roundTripIssuesOf(template, text, markers, values);
}

export function placedText(text: string, { given, placed }: Values): string {
  return placeholdersReplaced(text, (name) => placed.get(name) ?? given.get(name) ?? `{${name}}`);
}

function placeholdersOfTheWay(entry: ProviderEntry, way: CredentialWay | undefined): Placeholders {
  return { ...entry.placeholders, ...way?.placeholders };
}

/**
 * The way whose own values an addition or a choice through it is checked for, given these values: none for a way of a
 * service account Auto manages, whose values are set once Auto creates the account, not by the caller, and none for a
 * way that leaves them to the page its connection's link opens (`leavesItsValuesToThePage`), where the person gives
 * them before the connection is approved.
 */
export function wayAskingItsValues(way: CredentialWay, given: Given): CredentialWay | undefined {
  return way.managed_service_account === true || leavesItsValuesToThePage(way, given) ? undefined : way;
}

/**
 * Whether an addition through the way takes the values given, by their names alone: each is one the provider or the
 * way asks, and none of those they require is left out, where the way asks its own values of the addition at all
 * (`wayAskingItsValues`). An addition through a way that does not is refused, so one that names no way does not take
 * it.
 */
export function takesTheValuesGiven(entry: ProviderEntry, way: CredentialWay, given: Given): boolean {
  const placeholders = placeholdersOfTheWay(entry, wayAskingItsValues(way, given));
  return (
    Object.keys(given).every((name) => Object.hasOwn(placeholders, name)) &&
    Object.entries(placeholders).every(
      ([name, placeholder]: readonly [string, Placeholder]) => !isRequired(placeholder) || Object.hasOwn(given, name),
    )
  );
}

export function valuesOf(
  entry: ProviderEntry,
  way: CredentialWay | undefined,
  given: Given,
): Result.Result<Values, readonly Issue[]> {
  const placeholders = placeholdersOfTheWay(entry, way);
  const issues = [...unknownIssuesOf(entry, placeholders, given), ...declaredIssuesOf(placeholders, given)];
  if (issues.length > 0) {
    return Result.fail(issues);
  }
  const values = { given: new Map(Object.entries(given)), placed: setOfTheChosen(placeholders, given) };
  const placing = templatedFieldsOf({ ...entry, credentials: way === undefined ? [] : [way] })
    .filter(({ holds, text }) => holds === 'address' && isAddress(text))
    .flatMap((field) => fieldIssuesOf(field, values));
  const once = [
    ...new Map(placing.map((issue): readonly [string, Issue] => [`${issue.pointer} ${issue.detail}`, issue])).values(),
  ];
  return once.length > 0 ? Result.fail(once) : Result.succeed(values);
}
