export interface InputBudget {
  readonly allowed: number;
  readonly asked: number | undefined;
  readonly most: number;
}

export interface TurnLimits {
  readonly contextWindow: number | undefined;
  readonly budget: InputBudget;
}

export interface TurnAnswered {
  readonly sentBytes: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly calls: number;
}

interface RatedTurn {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly calls: number;
  readonly bytesPerToken: number;
}

export interface Meter {
  readonly last: RatedTurn | null;
  readonly answeredBytes: number;
  readonly spentInputTokens: number;
  readonly lastInputTokens: number | null;
}

export const noTurns: Meter = { last: null, answeredBytes: 0, spentInputTokens: 0, lastInputTokens: null };

function ratedOf({ sentBytes, inputTokens, outputTokens, calls }: TurnAnswered): RatedTurn | null {
  return inputTokens === null || inputTokens <= 0
    ? null
    : { inputTokens, outputTokens: outputTokens ?? 0, calls, bytesPerToken: sentBytes / inputTokens };
}

export function turnAnswered(meter: Meter, answered: TurnAnswered): Meter {
  return {
    last: ratedOf(answered),
    answeredBytes: 0,
    spentInputTokens: meter.spentInputTokens + (answered.inputTokens ?? 0),
    lastInputTokens: answered.inputTokens ?? meter.lastInputTokens,
  };
}

const utf8 = new TextEncoder();

export function toolAnswered(meter: Meter, text: string): Meter {
  return { ...meter, answeredBytes: meter.answeredBytes + utf8.encode(text).byteLength };
}

function bytesOf(texts: readonly string[]): number {
  return texts.reduce((bytes, text) => bytes + utf8.encode(text).byteLength, 0);
}

export function refusalsRetold(meter: Meter, withdrawn: readonly string[], given: readonly string[]): Meter {
  return { ...meter, answeredBytes: meter.answeredBytes - bytesOf(withdrawn) + bytesOf(given) };
}

function inputTokensLeft(meter: Meter, { budget }: TurnLimits): number {
  return budget.allowed - meter.spentInputTokens;
}

export function roomOfEachAnswer(meter: Meter, limits: TurnLimits): number | undefined {
  const turn = meter.last;
  if (turn === null || limits.contextWindow === undefined) {
    return undefined;
  }
  const roomTokens = Math.min(limits.contextWindow, inputTokensLeft(meter, limits)) - turn.inputTokens;
  return Math.max(0, Math.floor(((roomTokens - turn.outputTokens) * turn.bytesPerToken) / Math.max(1, turn.calls)));
}

export function leavesNoNextTurn(meter: Meter, limits: TurnLimits): boolean {
  const turn = meter.last;
  if (turn === null) {
    return false;
  }
  const projected = turn.inputTokens + turn.outputTokens + meter.answeredBytes / turn.bytesPerToken;
  return inputTokensLeft(meter, limits) - projected < projected;
}
