import { credentialProblems, placeholdersReplaced } from '@on.auto/config';
import { alternatives, listed, type Issue } from '@on.auto/operations';
import { JsonPointer, Option, Result } from 'effect';

import { isRequired, patternOf, type Choice, type Placeholder } from '../entry/placeholders.ts';
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

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

function pointerOf(name: string): string {
  return `/placeholders/${JsonPointer.escapeToken(name)}`;
}

function patternIssueOf(name: string, { pattern, example }: Placeholder, value: string): string | undefined {
  const written = required(pattern);
  if (!required(patternOf(written)).test(value)) {
    return `Expected a value that matches ${written}, such as ${required(example)}`;
  }
  if (credentialProblems(name, value, '', [name]).length > 0) {
    return heldCredential;
  }
  return value.includes('$') ? heldDollar : undefined;
}

function valueIssueOf(name: string, placeholder: Placeholder, value: string): string | undefined {
  const { choices } = placeholder;
  if (choices === undefined) {
    return patternIssueOf(name, placeholder, value);
  }
  return choices.some((choice) => choice.value === value)
    ? undefined
    : `Expected one of ${alternatives(choices.map((choice) => choice.value))}`;
}

function unknownIssuesOf(provider: string, placeholders: Placeholders, given: Given): readonly Issue[] {
  const declared = Object.keys(placeholders);
  const takes = declared.length === 0 ? 'it takes none' : `it takes ${listed(declared)}`;
  return Object.keys(given)
    .filter((name) => !Object.hasOwn(placeholders, name))
    .map((name) => ({
      pointer: pointerOf(name),
      detail: `The provider ${provider} has no placeholder ${name}; ${takes}`,
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
    const value = required(values.given.get(name));
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
    const issue = positionIssueOf(required(values.given.get(name)), hostname.includes(marker));
    return issue === undefined ? [] : [{ pointer: pointerOf(name), detail: issue }];
  });
  return positioned.length > 0 ? positioned : roundTripIssuesOf(template, text, markers, values);
}

export function placedText(text: string, { given, placed }: Values): string {
  return placeholdersReplaced(text, (name) => placed.get(name) ?? given.get(name) ?? `{${name}}`);
}

export function valuesOf(entry: ProviderEntry, given: Given): Result.Result<Values, readonly Issue[]> {
  const { placeholders = {} } = entry;
  const issues = [...unknownIssuesOf(entry.name, placeholders, given), ...declaredIssuesOf(placeholders, given)];
  if (issues.length > 0) {
    return Result.fail(issues);
  }
  const values = { given: new Map(Object.entries(given)), placed: setOfTheChosen(placeholders, given) };
  const placing = templatedFieldsOf(entry)
    .filter(({ holds, text }) => holds === 'address' && isAddress(text))
    .flatMap((field) => fieldIssuesOf(field, values));
  const once = [
    ...new Map(placing.map((issue): readonly [string, Issue] => [`${issue.pointer} ${issue.detail}`, issue])).values(),
  ];
  return once.length > 0 ? Result.fail(once) : Result.succeed(values);
}
