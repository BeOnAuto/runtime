import type { Conflict } from '../outcome/conflict.ts';
import type { ProjectedMessage } from '../projections/keyed-projection.ts';

export interface DefinitionName {
  readonly playbookKey: string;
  readonly definitionType: string;
  readonly name: string;
  readonly status: string;
  readonly hasTriggers: boolean;
}

export interface HeldName extends DefinitionName {
  readonly definitionKey: string;
}

export type NameAfter = DefinitionName | 'released' | undefined;

export interface NamedMessage extends ProjectedMessage {
  readonly stream: string;
}

export interface NameBound {
  readonly checkedBy: readonly string[];
  readonly counts: (name: DefinitionName) => boolean;
  readonly most: (definitionType: string) => number;
  readonly beyond: (claimed: DefinitionName, factType: string, countedBefore: number, most: number) => Conflict;
}

export interface DefinitionNames {
  readonly types: readonly string[];
  readonly holdsNames: (stream: string) => boolean;
  readonly definitionKeyOf: (message: NamedMessage) => string | undefined;
  readonly nameAfter: (held: DefinitionName | undefined, message: NamedMessage) => NameAfter;
  readonly takenBy: (claimed: DefinitionName, holder: DefinitionName) => Conflict;
  readonly bounds?: readonly NameBound[];
}

export interface DefinitionInTheAppend {
  readonly definitionKey: string;
  readonly stream: string;
  readonly messages: readonly NamedMessage[];
}

export interface DefinitionJudged {
  readonly definitionKey: string;
  readonly stream: string;
  readonly held: HeldName | undefined;
  readonly end: DefinitionName | undefined;
  readonly changedBy: readonly NamedMessage[];
}

export interface NamesOfAKind {
  readonly playbookKey: string;
  readonly definitionType: string;
}

export interface Refusal {
  readonly conflict: Pick<Conflict, 'detail' | 'kind'>;
  readonly stream: string;
}

export interface Claim {
  readonly claimant: DefinitionJudged;
  readonly claimed: DefinitionName;
}

function inTheOrderOfTheirKeys<A>(keyed: ReadonlyMap<string, A>): readonly A[] {
  return [...keyed.keys()]
    .toSorted()
    .map((key) => keyed.get(key))
    .filter((value) => value !== undefined);
}

export function definitionsInTheAppend(
  names: DefinitionNames,
  messages: readonly NamedMessage[],
): readonly DefinitionInTheAppend[] {
  const byKey = new Map<string, DefinitionInTheAppend>();
  for (const message of messages) {
    const definitionKey = names.holdsNames(message.stream) ? names.definitionKeyOf(message) : undefined;
    if (definitionKey !== undefined) {
      const before = byKey.get(definitionKey)?.messages ?? [];
      byKey.set(definitionKey, { definitionKey, stream: message.stream, messages: [...before, message] });
    }
  }
  return inTheOrderOfTheirKeys(byKey);
}

export function isTheSameName(one: DefinitionName | undefined, other: DefinitionName): boolean {
  return (
    one !== undefined &&
    one.playbookKey === other.playbookKey &&
    one.definitionType === other.definitionType &&
    one.name === other.name
  );
}

export function judgedOf(
  names: DefinitionNames,
  { definitionKey, stream, messages }: DefinitionInTheAppend,
  held: HeldName | undefined,
): DefinitionJudged {
  let end: DefinitionName | undefined = held;
  const changedBy: NamedMessage[] = [];
  for (const message of messages) {
    const after = names.nameAfter(end, message);
    if (after !== undefined) {
      end = after === 'released' ? undefined : after;
      changedBy.push(message);
    }
  }
  return { definitionKey, stream, held, end, changedBy };
}

export function nameKeyOf({ definitionType, name }: DefinitionName): string {
  return `${definitionType}/${name}`;
}

export function claimsOf(judged: readonly DefinitionJudged[]): readonly Claim[] {
  const claims = new Map<string, Claim>();
  for (const claimant of judged) {
    if (claimant.end !== undefined && !isTheSameName(claimant.held, claimant.end)) {
      const { playbookKey } = claimant.end;
      claims.set(JSON.stringify([playbookKey, nameKeyOf(claimant.end), claimant.definitionKey]), {
        claimant,
        claimed: claimant.end,
      });
    }
  }
  return inTheOrderOfTheirKeys(claims);
}

function heldAtTheEnd(judged: readonly DefinitionJudged[], definitionKey: string, claimed: DefinitionName): boolean {
  const holding = judged.find((definition) => definition.definitionKey === definitionKey);
  return holding === undefined || isTheSameName(holding.end, claimed);
}

type HoldingAtTheEnd = DefinitionJudged & { readonly end: DefinitionName };

function otherClaimantOf(judged: readonly DefinitionJudged[], { claimant, claimed }: Claim): HeldName | undefined {
  const other = judged.find(
    (definition): definition is HoldingAtTheEnd =>
      definition.definitionKey !== claimant.definitionKey && isTheSameName(definition.end, claimed),
  );
  return other === undefined ? undefined : { ...other.end, definitionKey: other.definitionKey };
}

export function takenRefusal(
  names: DefinitionNames,
  judged: readonly DefinitionJudged[],
  claim: Claim,
  holder?: HeldName,
): Refusal | undefined {
  const { claimant, claimed } = claim;
  const holding =
    holder !== undefined &&
    holder.definitionKey !== claimant.definitionKey &&
    heldAtTheEnd(judged, holder.definitionKey, claimed)
      ? holder
      : otherClaimantOf(judged, claim);
  return holding === undefined ? undefined : { conflict: names.takenBy(claimed, holding), stream: claimant.stream };
}

function kindOf({ playbookKey, definitionType }: DefinitionName): NamesOfAKind {
  return { playbookKey, definitionType };
}

function kindKeyOf({ playbookKey, definitionType }: NamesOfAKind): string {
  return JSON.stringify([playbookKey, definitionType]);
}

export function kindsChanged(judged: readonly DefinitionJudged[]): readonly NamesOfAKind[] {
  const kinds = new Map<string, NamesOfAKind>();
  for (const { held, end, changedBy } of judged) {
    const names = changedBy.length === 0 ? [] : [held, end].filter((name) => name !== undefined);
    for (const name of names) {
      kinds.set(kindKeyOf(kindOf(name)), kindOf(name));
    }
  }
  return inTheOrderOfTheirKeys(kinds);
}

export function isOfTheKind(name: DefinitionName, kind: NamesOfAKind): boolean {
  return name.playbookKey === kind.playbookKey && name.definitionType === kind.definitionType;
}

function namesAfter(
  before: readonly HeldName[],
  judged: readonly DefinitionJudged[],
  kind: NamesOfAKind,
): readonly DefinitionName[] {
  const inTheAppend = new Set(judged.map(({ definitionKey }) => definitionKey));
  const ends = judged
    .map(({ end }) => end)
    .filter((end) => end !== undefined)
    .filter((end) => isOfTheKind(end, kind));
  return [...before.filter(({ definitionKey }) => !inTheAppend.has(definitionKey)), ...ends];
}

interface Checked {
  readonly end: DefinitionName;
  readonly factType: string;
  readonly stream: string;
}

function checkedBy(bound: NameBound, kind: NamesOfAKind, { end, changedBy, stream }: DefinitionJudged): Checked[] {
  const factType = changedBy.findLast(({ type }) => bound.checkedBy.includes(type))?.type;
  return end === undefined || factType === undefined || !isOfTheKind(end, kind) || !bound.counts(end)
    ? []
    : [{ end, factType, stream }];
}

function beyondTheBound(
  bound: NameBound,
  judged: readonly DefinitionJudged[],
  kind: NamesOfAKind,
  before: readonly HeldName[],
): Refusal | undefined {
  const most = bound.most(kind.definitionType);
  const countedAfter = namesAfter(before, judged, kind).filter((name) => bound.counts(name)).length;
  const [checked] = countedAfter > most ? judged.flatMap((definition) => checkedBy(bound, kind, definition)) : [];
  if (checked === undefined) {
    return undefined;
  }
  const countedBefore = before.filter((name) => bound.counts(name)).length;
  return { conflict: bound.beyond(checked.end, checked.factType, countedBefore, most), stream: checked.stream };
}

export function boundRefusal(
  names: DefinitionNames,
  judged: readonly DefinitionJudged[],
  kind: NamesOfAKind,
  before: readonly HeldName[],
): Refusal | undefined {
  for (const bound of names.bounds ?? []) {
    const refusal = beyondTheBound(bound, judged, kind, before);
    if (refusal !== undefined) {
      return refusal;
    }
  }
  return undefined;
}
