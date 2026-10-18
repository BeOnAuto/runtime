import { Schema, SchemaAST, SchemaIssue } from 'effect';

import { formatCheckId, formatOfCheck } from './format-checks.ts';
import { pointerOf, type SchemaIssue as Issue } from './json-bounds.ts';
import type { FormatName } from './string-formats.ts';

export type Breach =
  | { readonly rule: 'kind' }
  | { readonly rule: 'missing' }
  | { readonly rule: 'unexpected' }
  | { readonly rule: 'bound'; readonly keywords: Schema.JsonObject }
  | { readonly rule: 'format'; readonly format: FormatName };

export interface FoundIssue extends Issue {
  readonly breach?: Breach;
  readonly ofTheName?: true;
}

interface Within {
  readonly path: readonly PropertyKey[];
  readonly holder?: SchemaAST.AST | undefined;
  readonly ofTheName?: true;
}

interface Leaf extends Within {
  readonly issue: SchemaIssue.Issue;
}

const namesCheck = 'effect/schema/isPropertyNames';

type CheckBreach = (filter: SchemaAST.Filter<unknown>, holder: SchemaAST.AST | undefined) => Breach;

const detailOf = SchemaIssue.makeFormatterDefault();

const limitsOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Number));

const ofAnotherKind: Breach = { rule: 'kind' };

function boundNamed(keyword: string): CheckBreach {
  return (filter) => ({
    rule: 'bound',
    keywords: Object.fromEntries(
      Object.values(limitsOf(filter.annotations?.representation?.payload)).map((limit) => [keyword, limit]),
    ),
  });
}

function formatNamed(filter: SchemaAST.Filter<unknown>): Breach {
  return { rule: 'format', format: formatOfCheck(filter.annotations?.representation?.payload) };
}

function lengthOrItems(filter: SchemaAST.Filter<unknown>, holder: SchemaAST.AST | undefined): Breach {
  return boundNamed(holder !== undefined && SchemaAST.isString(holder) ? 'minLength' : 'minItems')(filter, holder);
}

const breachesOfChecks: ReadonlyMap<string | undefined, CheckBreach> = new Map<string | undefined, CheckBreach>([
  ['effect/schema/isMinCodePoints', boundNamed('minLength')],
  ['effect/schema/isMaxCodePoints', boundNamed('maxLength')],
  ['effect/schema/isMinLength', lengthOrItems],
  ['effect/schema/isMaxLength', boundNamed('maxItems')],
  ['effect/schema/isGreaterThanOrEqualTo', boundNamed('minimum')],
  ['effect/schema/isLessThanOrEqualTo', boundNamed('maximum')],
  ['effect/schema/isGreaterThan', boundNamed('exclusiveMinimum')],
  ['effect/schema/isLessThan', boundNamed('exclusiveMaximum')],
  ['effect/schema/isMultipleOf', boundNamed('multipleOf')],
  ['effect/schema/isMinProperties', boundNamed('minProperties')],
  ['effect/schema/isMaxProperties', boundNamed('maxProperties')],
  ['effect/schema/isUnique', () => ({ rule: 'bound', keywords: { uniqueItems: true } })],
  ['effect/schema/isInt', () => ofAnotherKind],
  [formatCheckId, formatNamed],
]);

function isTheCheckOfNames(issue: SchemaIssue.Issue): issue is SchemaIssue.Filter {
  return issue instanceof SchemaIssue.Filter && issue.filter.annotations?.representation?.id === namesCheck;
}

function leavesOf(issue: SchemaIssue.Issue, within: Within): Leaf[] {
  if (issue instanceof SchemaIssue.Pointer) {
    return leavesOf(issue.issue, { ...within, path: [...within.path, ...issue.path] });
  }
  if (issue instanceof SchemaIssue.Composite || (issue instanceof SchemaIssue.AnyOf && issue.issues.length > 0)) {
    return issue.issues.flatMap((inner) => leavesOf(inner, { ...within, holder: issue.ast }));
  }
  if (isTheCheckOfNames(issue)) {
    return leavesOf(issue.issue, { ...within, ofTheName: true });
  }
  return [{ ...within, issue }];
}

function isAValueWhereNoneIsAllowed(issue: SchemaIssue.Issue): boolean {
  return (
    issue instanceof SchemaIssue.UnexpectedKey ||
    (issue instanceof SchemaIssue.InvalidType && SchemaAST.isNever(issue.ast))
  );
}

function breachOfTheValue({ issue, holder }: Leaf): Breach | undefined {
  if (issue instanceof SchemaIssue.InvalidType || issue instanceof SchemaIssue.AnyOf) {
    return ofAnotherKind;
  }
  return issue instanceof SchemaIssue.Filter
    ? breachesOfChecks.get(issue.filter.annotations?.representation?.id)?.(issue.filter, holder)
    : undefined;
}

function breachOf(leaf: Leaf): Breach | undefined {
  if (leaf.issue instanceof SchemaIssue.MissingKey) {
    return { rule: 'missing' };
  }
  return isAValueWhereNoneIsAllowed(leaf.issue) ? { rule: 'unexpected' } : breachOfTheValue(leaf);
}

function foundOf(leaf: Leaf): FoundIssue {
  const breach = breachOf(leaf);
  return {
    pointer: pointerOf(leaf.path),
    detail: detailOf(leaf.issue),
    ...(breach === undefined ? {} : { breach }),
    ...(leaf.ofTheName === undefined ? {} : { ofTheName: leaf.ofTheName }),
  };
}

export function foundIssuesOf(issue: SchemaIssue.Issue): readonly FoundIssue[] {
  return leavesOf(issue, { path: [] }).map((leaf) => foundOf(leaf));
}
