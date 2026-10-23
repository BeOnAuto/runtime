import { entriesOf, field, isObject, pointerTo, taskKinds, type Json } from '@on.auto/workflow-engine';

import type { SchemaCheck, SchemaRefusal } from './specification-schema.ts';

export interface Problem {
  readonly pointer: string;
  readonly detail: string;
}

interface Branch {
  readonly at: string;
  readonly pointer: string;
}

interface PropertyClaim extends Branch {
  readonly kind: 'missing' | 'unknown';
  readonly property: string;
}

interface KeywordClaim extends Branch {
  readonly kind: 'keyword';
  readonly keyword: string;
  readonly rule: Json | undefined;
}

type Claim = PropertyClaim | KeywordClaim;

const branchKeys: ReadonlySet<string> = new Set([...taskKinds, 'with']);

const branchKeywords: ReadonlySet<string> = new Set(['anyOf', 'const', 'if', 'not', 'oneOf']);

const discriminatingKeywords: ReadonlySet<string> = new Set(['const', 'not']);

const alternativeKeywords: ReadonlySet<string> = new Set(['anyOf', 'oneOf']);

const annotatingKeywords: ReadonlySet<string> = new Set([
  '$ref',
  'allOf',
  'anyOf',
  'dependentSchemas',
  'else',
  'oneOf',
  'then',
]);

const subschemaKeywords: ReadonlySet<string> = new Set([
  '$ref',
  'additionalItems',
  'additionalProperties',
  'allOf',
  'dependentSchemas',
  'else',
  'items',
  'patternProperties',
  'prefixItems',
  'properties',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

const typeNames: ReadonlyMap<Json | undefined, string> = new Map([
  ['array', 'an array'],
  ['boolean', 'a boolean'],
  ['integer', 'an integer'],
  ['null', 'null'],
  ['number', 'a number'],
  ['object', 'an object'],
  ['string', 'a string'],
]);

const wordings: Readonly<Record<string, (rule: Json | undefined) => string>> = {
  anyOf: () => 'It matches none of the alternatives the DSL allows here',
  const: (rule) => `It must be ${quoted(rule)}`,
  enum: (rule) => `It must be one of ${listed(rule, (value) => quoted(value), ', ')}`,
  format: (rule) => `It must be in the format ${quoted(rule)}`,
  maxProperties: () => 'It has more properties than the DSL allows here',
  maximum: (rule) => `It must be at most ${JSON.stringify(rule)}`,
  minItems: (rule) => `It needs at least ${JSON.stringify(rule)} items`,
  minLength: (rule) => `It needs at least ${JSON.stringify(rule)} characters`,
  minProperties: (rule) => `It needs at least ${JSON.stringify(rule)} properties`,
  minimum: (rule) => `It must be at least ${JSON.stringify(rule)}`,
  not: () => 'It is a value the DSL does not allow here',
  oneOf: () => 'It does not match exactly one of the alternatives the DSL allows here',
  pattern: (rule) => `It must match the pattern ${quoted(rule)}`,
  type: (rule) => `It must be ${listed(rule, (type) => typeNames.get(type) ?? JSON.stringify(type), ' or ')}`,
};

const alternativeBranch = /\/(?:anyOf|oneOf)\/\d+(?:\/|$)/u;

const untypedTask = `The task has no type the DSL knows: a task is one of ${taskKinds.toSorted().join(', ')}`;

export function problemsOf({ base, task, refusals }: SchemaCheck): readonly Problem[] {
  const claims = refusals.flatMap((refusal) => claimsOf(refusal));
  const taken = withoutBranchesNotTaken(claims, task);
  const shown = furthestAlternatives(withoutEchoes(taken, claims), task).filter((claim) => isShown(claim, task));
  return distinct(
    foundIn(
      shown,
      taken,
      claims.some((claim) => isMissingBranchKey(claim, task)),
    ),
  ).map(({ pointer, detail }) => ({ pointer: `${base}${pointer}`, detail }));
}

function claimsOf({ keyword, at, pointer, rule, value }: SchemaRefusal): readonly Claim[] {
  if (keyword === 'required') {
    return [rule]
      .flat()
      .filter((name) => typeof name === 'string')
      .filter((name) => isObject(value) && field(value, name) === undefined)
      .map((property): Claim => ({ kind: 'missing', at, pointer, property }));
  }
  if (keyword === 'not' && isObject(rule) && entriesOf(rule).length === 0) {
    return [{ kind: 'unknown', at: parentOf(at), pointer: parentOf(pointer), property: lastNameOf(pointer) }];
  }
  return [{ kind: 'keyword', keyword, at, pointer, rule }];
}

function listed(rule: Json | undefined, word: (value: Json | undefined) => string, separator: string): string {
  return [rule]
    .flat()
    .map((value) => word(value))
    .join(separator);
}

function quoted(rule: Json | undefined): string {
  return typeof rule === 'string' ? `"${rule}"` : JSON.stringify(rule);
}

function foundIn(shown: readonly Claim[], taken: readonly Claim[], untyped: boolean): readonly Problem[] {
  if (shown.length > 0) {
    return shown.map((claim) => ({ pointer: claim.pointer, detail: describe(claim) }));
  }
  if (untyped) {
    return [{ pointer: '', detail: untypedTask }];
  }
  return taken.flatMap((claim) =>
    claim.kind === 'keyword' && branchKeywords.has(claim.keyword)
      ? [{ pointer: claim.pointer, detail: describe(claim) }]
      : [],
  );
}

function describe(claim: Claim): string {
  if (claim.kind === 'keyword') {
    const wording = wordings[claim.keyword] ?? (() => `It breaks the rule ${claim.keyword} the DSL sets here`);
    return wording(claim.rule);
  }
  return claim.kind === 'missing'
    ? `It needs ${claim.property}`
    : `It has ${claim.property}, which the DSL does not know here`;
}

function isShown(claim: Claim, task: boolean): boolean {
  return claim.kind === 'keyword'
    ? !subschemaKeywords.has(claim.keyword) && !branchKeywords.has(claim.keyword)
    : !isMissingBranchKey(claim, task);
}

function isMissingBranchKey(claim: Claim, task: boolean): boolean {
  return task && claim.kind === 'missing' && claim.pointer === '' && branchKeys.has(claim.property);
}

function discriminates(claim: Claim, task: boolean): boolean {
  return claim.kind === 'keyword' ? discriminatingKeywords.has(claim.keyword) : isMissingBranchKey(claim, task);
}

function isAlternative(claim: Claim): boolean {
  return claim.kind === 'keyword' && alternativeKeywords.has(claim.keyword);
}

function withoutBranchesNotTaken(claims: readonly Claim[], task: boolean): readonly Claim[] {
  const notTaken: readonly Branch[] = claims
    .filter((choice) => isAlternative(choice))
    .flatMap((choice) =>
      claims
        .filter((claim) => discriminates(claim, task) && isDirectlyIn(claim, choice))
        .map((claim) => branchOf(claim, choice)),
    );
  return claims.filter((claim) => !notTaken.some((branch) => isIn(claim, branch)));
}

function withoutEchoes(taken: readonly Claim[], claims: readonly Claim[]): readonly Claim[] {
  return taken.filter((claim) => claim.kind !== 'unknown' || !isEcho(claim, taken, claims));
}

function isEcho(unknown: PropertyClaim, taken: readonly Claim[], claims: readonly Claim[]): boolean {
  const named = pointerTo(unknown.pointer, unknown.property);
  const schema = parentOf(unknown.at);
  return (
    claims.some((claim) => isUnder(claim.pointer, named)) ||
    taken.some(
      (claim) =>
        claim.kind === 'keyword' &&
        annotatingKeywords.has(claim.keyword) &&
        claim.pointer === unknown.pointer &&
        parentOf(claim.at) === schema,
    )
  );
}

function furthestAlternatives(claims: readonly Claim[], task: boolean): readonly Claim[] {
  return claims
    .filter((choice) => isAlternative(choice))
    .toSorted((left, right) => right.at.length - left.at.length)
    .reduce((kept, choice) => withoutBranchesBehind(kept, choice, task), claims);
}

function withoutBranchesBehind(claims: readonly Claim[], choice: Claim, task: boolean): readonly Claim[] {
  const branches = Map.groupBy(
    claims.filter((claim) => isShown(claim, task) && isIn(claim, choice)),
    (claim) => branchOf(claim, choice).at,
  );
  const reach = [...branches].map(([branch, shown]: readonly [string, readonly Claim[]]): readonly [string, number] => [
    branch,
    Math.max(...shown.map(({ pointer }) => depthOf(pointer))),
  ]);
  const furthest = Math.max(...reach.map(([, depth]) => depth));
  const behind = new Set(reach.filter(([, depth]) => depth < furthest).map(([branch]) => branch));
  return claims.filter((claim) => !(isIn(claim, choice) && behind.has(branchOf(claim, choice).at)));
}

function branchOf(claim: Claim, choice: Branch): Branch {
  const index = claim.at.slice(choice.at.length + 1).replace(/\/.*/u, '');
  return { at: `${choice.at}/${index}`, pointer: choice.pointer };
}

function isDirectlyIn(claim: Claim, choice: Branch): boolean {
  return isIn(claim, choice) && !alternativeBranch.test(claim.at.slice(branchOf(claim, choice).at.length));
}

function isIn(claim: Claim, branch: Branch): boolean {
  return claim.at.startsWith(`${branch.at}/`) && isUnder(claim.pointer, branch.pointer);
}

function isUnder(pointer: string, parent: string): boolean {
  return pointer === parent || pointer.startsWith(`${parent}/`);
}

function parentOf(place: string): string {
  return place.slice(0, place.lastIndexOf('/'));
}

function lastNameOf(pointer: string): string {
  return pointer
    .slice(pointer.lastIndexOf('/') + 1)
    .replaceAll('~1', '/')
    .replaceAll('~0', '~');
}

function depthOf(pointer: string): number {
  return pointer.split('/').length;
}

function distinct(problems: readonly Problem[]): readonly Problem[] {
  const seen = new Set<string>();
  return problems.filter(({ pointer, detail }) => {
    const key = `${pointer}\n${detail}`;
    const fresh = !seen.has(key);
    seen.add(key);
    return fresh;
  });
}
