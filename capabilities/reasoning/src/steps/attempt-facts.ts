import {
  numberingAfter,
  numberingFrom,
  type CallEnd,
  type CallNumbering,
  type RecordedCallFact,
  type RunAttempt,
} from '@on.auto/definitions';
import type { CallStarted } from '@on.auto/tool-servers';

import { providerOf } from '../model/model-reference.ts';
import { addedUsage, unknownUsage, type TokenUsage } from '../model/model-result.ts';

export type StepFact = RecordedCallFact;

type InterruptedEnd = Extract<StepFact & CallEnd, { readonly type: 'model_call_failed' | 'tool_call_failed' }>;

export type FactData<Type extends StepFact['type']> = Extract<StepFact, { readonly type: Type }>['data'];

interface Spent {
  readonly calls: number;
  readonly usage: TokenUsage;
  readonly duration_ms: number;
  readonly cost_usd?: number;
}

interface UsedTool {
  readonly server: string;
  readonly tool: string;
  readonly readOnly: boolean;
}

export interface AttemptFacts {
  readonly numbering: CallNumbering;
  readonly used: ReadonlyMap<string, UsedTool>;
  readonly spent: Spent;
  readonly resolvedModel: string | null;
}

export const notAnsweredBeforeItsAttemptEnded = 'The attempt that made this call ended before the call was answered';

export function noFactsYet(modelCallsBefore: number): AttemptFacts {
  return {
    numbering: numberingFrom(0, modelCallsBefore),
    used: new Map(),
    spent: { calls: 0, usage: unknownUsage, duration_ms: 0 },
    resolvedModel: null,
  };
}

interface Spending {
  readonly usage?: TokenUsage;
  readonly duration_ms: number;
  readonly cost_usd?: number;
}

function spentOn(spent: Spent, { usage, duration_ms: durationMs, cost_usd: cost }: Spending): Spent {
  const costs = [spent.cost_usd, cost].filter((each) => each !== undefined);
  return {
    calls: spent.calls + 1,
    usage: usage === undefined ? spent.usage : addedUsage(spent.usage, usage),
    duration_ms: spent.duration_ms + durationMs,
    ...(costs.length === 0 ? {} : { cost_usd: costs.reduce((total, each) => total + each, 0) }),
  };
}

function usedBy(used: ReadonlyMap<string, UsedTool>, { server, tool, read_only: readOnly }: CallStarted) {
  return new Map([...used, [`${server}/${tool}`, { server, tool, readOnly: readOnly === true }]]);
}

export function factsAfter(facts: AttemptFacts, fact: StepFact): AttemptFacts {
  const numbered = { ...facts, numbering: numberingAfter(facts.numbering, fact) };
  if (fact.type === 'model_call_answered') {
    return { ...numbered, spent: spentOn(facts.spent, fact.data), resolvedModel: fact.data.resolved_model };
  }
  if (fact.type === 'model_call_failed') {
    return fact.data.because === 'interrupted' ? numbered : { ...numbered, spent: spentOn(facts.spent, fact.data) };
  }
  return fact.type === 'tool_call_started' ? { ...numbered, used: usedBy(facts.used, fact.data) } : numbered;
}

export function factsOf({ modelCallsBefore, calls }: RunAttempt): AttemptFacts {
  return calls.reduce<AttemptFacts>((facts, call) => factsAfter(facts, call), noFactsYet(modelCallsBefore));
}

export function openModelCallOf({ numbering }: AttemptFacts): number | null {
  return [...numbering.openModelCalls].at(0) ?? null;
}

export function providerOfTheFacts({ resolvedModel }: AttemptFacts, model: string): string {
  return providerOf(resolvedModel ?? model);
}

export function interruptedEnds(facts: AttemptFacts, model: string): readonly InterruptedEnd[] {
  const { numbering } = facts;
  const provider = providerOfTheFacts(facts, model);
  const modelCalls = [...numbering.openModelCalls].map((number): InterruptedEnd => ({
    type: 'model_call_failed',
    data: { number, because: 'interrupted', provider, detail: notAnsweredBeforeItsAttemptEnded, duration_ms: 0 },
  }));
  const toolCalls = [...numbering.openCalls].map((number): InterruptedEnd => ({
    type: 'tool_call_failed',
    data: { number, because: 'interrupted', duration_ms: 0, jsonrpc_id: null },
  }));
  return [...modelCalls, ...toolCalls];
}
