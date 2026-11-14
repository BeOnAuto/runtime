import { plainNumber } from '@on.auto/phrasing';

import { agentIssue, type GoalIssue } from './goal-issues.ts';

export type Mapping = Readonly<Record<string, unknown>>;

export function isMapping(value: unknown): value is Mapping {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Findings {
  readonly add: (issue: GoalIssue) => void;
  readonly found: () => readonly GoalIssue[];
}

export function findingsOf(): Findings {
  const issues: GoalIssue[] = [];
  return {
    add: (issue) => {
      issues.push(issue);
    },
    found: () => [...issues],
  };
}

export interface Holder {
  readonly mapping: Mapping;
  readonly pointer: string;
  readonly findings: Findings;
}

type Need = 'optional' | (() => GoalIssue);

interface Field {
  readonly key: string;
  readonly what: string;
  readonly need: Need;
}

interface Length {
  readonly least: number;
  readonly most: number;
}

export function pointerOf(holder: Holder, key: string): string {
  return `${holder.pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

const plainKey = /^[\p{L}\p{N}_-]+$/u;

const mostKeyCharacters = 40;

function keyWords(key: string): string {
  if (!plainKey.test(key)) {
    return 'of that name';
  }
  const characters = Array.from(key);
  return characters.length > mostKeyCharacters ? `${characters.slice(0, mostKeyCharacters).join('')}…` : key;
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

export function presentIn(mapping: Mapping, key: string): boolean {
  return Object.hasOwn(mapping, key);
}

function given(holder: Holder, { key, need }: Field): boolean {
  if (presentIn(holder.mapping, key)) {
    return true;
  }
  if (need !== 'optional') {
    holder.findings.add(need());
  }
  return false;
}

function refuse(holder: Holder, { key, what }: Field, expected: string): void {
  holder.findings.add(agentIssue(pointerOf(holder, key), `${what} ${expected}`));
}

export function onlyKnownKeys(holder: Holder, what: string, known: readonly string[]): void {
  for (const unknown of Object.keys(holder.mapping).filter((key) => !known.includes(key))) {
    holder.findings.add(
      agentIssue(pointerOf(holder, unknown), `${what} takes no key ${keyWords(unknown)}; it takes ${known.join(', ')}`),
    );
  }
}

function acceptedIn<Value>(
  holder: Holder,
  field: Field,
  accepted: (value: unknown) => Value | undefined,
  expected: string,
): Value | undefined {
  if (!given(holder, field)) {
    return undefined;
  }
  const value = accepted(holder.mapping[field.key]);
  if (value === undefined) {
    refuse(holder, field, expected);
  }
  return value;
}

export function mappingIn(holder: Holder, field: Field): Holder | undefined {
  const mapping = acceptedIn(
    holder,
    field,
    (value) => (isMapping(value) ? value : undefined),
    'is a set of keys and their values',
  );
  return mapping === undefined
    ? undefined
    : { mapping, pointer: pointerOf(holder, field.key), findings: holder.findings };
}

function isBlank(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}

export function textIn(holder: Holder, field: Field, { least, most }: Length): string | undefined {
  if (field.need !== 'optional' && isBlank(holder.mapping[field.key])) {
    holder.findings.add(field.need());
    return undefined;
  }
  return acceptedIn(
    holder,
    field,
    (value) => {
      const characters = typeof value === 'string' ? Array.from(value.trim()).length : -1;
      return typeof value === 'string' && characters >= least && characters <= most ? value : undefined;
    },
    `is text of ${plainNumber(least)} to ${plainNumber(most)} characters`,
  );
}

export function nameIn(holder: Holder, field: Field, pattern: Readonly<RegExp>): string | undefined {
  return acceptedIn(
    holder,
    field,
    (value) => (typeof value === 'string' && pattern.test(value) ? value : undefined),
    'starts with a lowercase letter and holds three to forty-eight lowercase letters, digits and hyphens',
  );
}

export function choiceIn<const Choice extends string>(
  holder: Holder,
  field: Field,
  choices: readonly Choice[],
): Choice | undefined {
  return acceptedIn(
    holder,
    field,
    (value) => choices.find((choice) => choice === value),
    `is one of ${choices.join(', ')}`,
  );
}

export function flagIn(holder: Holder, field: Field): boolean | undefined {
  return acceptedIn(holder, field, (value) => (typeof value === 'boolean' ? value : undefined), 'is true or false');
}

export function listIn(holder: Holder, field: Field): readonly unknown[] | undefined {
  return acceptedIn(holder, field, (value) => (isList(value) ? value : undefined), 'is a list');
}

export function finiteNumberIn(holder: Holder, field: Field): number | undefined {
  return acceptedIn(
    holder,
    field,
    (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined),
    'is a finite number',
  );
}
