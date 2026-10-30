import {
  strictRecordedDecoder,
  type KeptContent,
  type PresentedFact,
  type Presenter,
  type Recorded,
  type RecordedFact,
} from '@on.auto/operations';
import { Result, Schema } from 'effect';

import { reactionsStreamKind } from '../events/reaction-refusals.ts';
import { runDecidersOf, type RunDeciders } from '../runs/run-decider.ts';
import { isCoreRunFactType, type IsDeclared } from '../runs/run-events.ts';

export interface DeclaredFact {
  readonly type: string;
  readonly schema: Schema.Top & Schema.ConstraintDecoder<unknown>;
  readonly present: (recorded: RecordedFact, content: KeptContent) => PresentedFact;
}

export interface CapabilityFacts {
  readonly onRuns: readonly DeclaredFact[];
  readonly streams: readonly Presenter[];
}

export interface DeclaringCapability {
  readonly type: string;
  readonly facts: CapabilityFacts;
}

export const noFacts: CapabilityFacts = { onRuns: [], streams: [] };

export function declaredFact<Fact extends Recorded>(
  type: Fact['type'],
  schema: Schema.Top & Schema.ConstraintCodec<Fact, unknown>,
  present: (fact: Fact, content: KeptContent) => PresentedFact,
): DeclaredFact {
  const decode = strictRecordedDecoder(schema);
  return { type, schema, present: (recorded, content) => present(decode(recorded), content) };
}

export interface RunFacts extends RunDeciders {
  readonly declared: readonly DeclaredFact[];
}

interface Declaration {
  readonly name: string;
  readonly by: string;
}

function firstDeclaredAgain(declarations: readonly Declaration[]): readonly [Declaration, Declaration] | undefined {
  for (const [index, again] of declarations.entries()) {
    const first = declarations.slice(0, index).find(({ name }) => name === again.name);
    if (first !== undefined) {
      return [first, again];
    }
  }
  return undefined;
}

function requireDeclaredOnce(what: string, declarations: readonly Declaration[]): void {
  const twice = firstDeclaredAgain(declarations);
  if (twice !== undefined) {
    const [first, again] = twice;
    throw new Error(
      `The ${what} ${again.name} is declared by the capabilities ${first.by} and ${again.by}, and one capability alone may declare it`,
    );
  }
}

function requireNoCoreName(declarations: readonly Declaration[]): void {
  const core = declarations.find(({ name }) => isCoreRunFactType(name));
  if (core !== undefined) {
    throw new Error(`The fact ${core.name} that the capability ${core.by} declares is one the playbook records itself`);
  }
}

export const playbookStreamKinds: readonly string[] = ['runs', 'definitions', 'events', reactionsStreamKind];

function requireNoPlaybookStreamKind(declarations: readonly Declaration[]): void {
  const claimed = declarations.find(({ name }) => playbookStreamKinds.includes(name));
  if (claimed !== undefined) {
    throw new Error(
      `The stream kind ${claimed.name} that the capability ${claimed.by} declares is one the playbook records on itself`,
    );
  }
}

function isReadBy(schema: Schema.Top & Schema.ConstraintDecoder<unknown>): IsDeclared {
  const decode = Schema.decodeUnknownResult(Schema.toCodecJson(schema));
  return (fact) => Result.isSuccess(decode(fact));
}

export function runFactsOf(declared: readonly DeclaredFact[]): RunFacts {
  const types = new Set(declared.map(({ type }) => type));
  const isDeclared = isReadBy(Schema.Union(declared.map(({ schema }) => schema)));
  return { declared, ...runDecidersOf(isDeclared, ({ type }) => types.has(type)) };
}

export function declaredFactsOf(capabilities: readonly DeclaringCapability[]): readonly DeclaredFact[] {
  const declarations = capabilities.flatMap(({ type: by, facts }) =>
    facts.onRuns.map(({ type }) => ({ name: type, by })),
  );
  requireNoCoreName(declarations);
  requireDeclaredOnce('fact', declarations);
  return capabilities.flatMap(({ facts }) => facts.onRuns);
}

function ownedStreamsOf(capabilities: readonly DeclaringCapability[]): readonly Presenter[] {
  const declarations = capabilities.flatMap(({ type: by, facts }) =>
    facts.streams.map(({ streamKind }) => ({ name: streamKind, by })),
  );
  requireNoPlaybookStreamKind(declarations);
  requireDeclaredOnce('stream kind', declarations);
  return capabilities.flatMap(({ facts }) => facts.streams);
}

export function composedFactsOf(capabilities: readonly DeclaringCapability[]): CapabilityFacts {
  return { onRuns: declaredFactsOf(capabilities), streams: ownedStreamsOf(capabilities) };
}
