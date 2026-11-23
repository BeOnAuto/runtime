import { Predicate, type Schema } from 'effect';

import type { FoundIssue } from './found-issues.ts';
import { pointerOf } from './json-bounds.ts';

interface Case {
  readonly field: string;
  readonly choice: string;
  readonly required: readonly string[];
}

export interface RequiredByChoice {
  readonly field: string;
  readonly cases: readonly Case[];
}

const branchings = ['oneOf', 'anyOf'] as const;

const keysOfACase = new Set(['properties', 'required', 'title', 'description']);

const keysOfAChoice = new Set(['const', 'title', 'description']);

function isObject(value: unknown): value is Schema.JsonObject {
  return Predicate.isObject(value) && !Array.isArray(value);
}

function namesIn(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((name) => typeof name === 'string') : [];
}

function onlyKeys(value: Schema.JsonObject, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function caseOf(branch: Schema.Json): Case | undefined {
  if (!isObject(branch) || !onlyKeys(branch, keysOfACase) || !isObject(branch['properties'])) {
    return undefined;
  }
  const [named, ...more] = Object.entries(branch['properties']);
  const choice = named?.[1];
  const required = namesIn(branch['required']);
  if (named === undefined || more.length > 0 || !isObject(choice) || !onlyKeys(choice, keysOfAChoice)) {
    return undefined;
  }
  const value = choice['const'];
  return typeof value === 'string' ? { field: named[0], choice: value, required } : undefined;
}

function isList(value: Schema.Json | undefined): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

function casesOf(branches: Schema.Json | undefined): readonly Case[] {
  const cases = isList(branches) ? branches.map((branch) => caseOf(branch)) : [];
  return cases.every((each) => each !== undefined) ? cases : [];
}

function decidedBy(cases: readonly Case[], document: Schema.JsonObject): RequiredByChoice | undefined {
  const [field, ...others] = new Set(cases.map((each) => each.field));
  const choices = new Set(cases.map((each) => each.choice));
  const decides = document['type'] === 'object' && field !== undefined && namesIn(document['required']).includes(field);
  return decides && others.length === 0 && choices.size === cases.length ? { field, cases } : undefined;
}

export function requiredByChoiceIn(
  document: Schema.JsonObject,
): { readonly rest: Schema.JsonObject; readonly byChoice: RequiredByChoice } | undefined {
  const [branching, ...more] = branchings.filter((key) => key in document);
  const cases = branching === undefined || more.length > 0 ? [] : casesOf(document[branching]);
  const byChoice = decidedBy(cases, document);
  if (branching === undefined || byChoice === undefined) {
    return undefined;
  }
  const { [branching]: _cases, ...rest } = document;
  return { rest, byChoice };
}

function isGiven(value: Schema.Json | undefined): boolean {
  return value !== undefined && !(typeof value === 'string' && value.trim() === '');
}

function choicesIn({ cases }: RequiredByChoice): string {
  return cases.map(({ choice }) => JSON.stringify(choice)).join(' | ');
}

function missingFor({ field, choice, required }: Case, answer: Schema.JsonObject): readonly FoundIssue[] {
  return required
    .filter((name) => !isGiven(answer[name]))
    .map((name) => ({
      pointer: pointerOf([name]),
      detail: `Missing key when ${field} is ${JSON.stringify(choice)}`,
      breach: { rule: 'missing', when: { field, choice } },
    }));
}

export function requiredByChoiceIssues(byChoice: RequiredByChoice, value: Schema.Json): readonly FoundIssue[] {
  const choice = isObject(value) ? value[byChoice.field] : undefined;
  if (!isObject(value) || choice === undefined) {
    return [];
  }
  const decided = byChoice.cases.find((each) => each.choice === choice);
  return decided === undefined
    ? [{ pointer: pointerOf([byChoice.field]), detail: `Expected ${choicesIn(byChoice)}`, breach: { rule: 'kind' } }]
    : missingFor(decided, value);
}
