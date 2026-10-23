export interface TurnLimits {
  readonly contextWindow: number | undefined;
  readonly mostInputTokens: number;
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

export function roomOfEachAnswer(meter: Meter, { contextWindow, mostInputTokens }: TurnLimits): number | undefined {
  const turn = meter.last;
  if (turn === null || contextWindow === undefined) {
    return undefined;
  }
  const roomTokens = Math.min(contextWindow, mostInputTokens - meter.spentInputTokens) - turn.inputTokens;
  return Math.max(0, Math.floor(((roomTokens - turn.outputTokens) * turn.bytesPerToken) / Math.max(1, turn.calls)));
}

export function leavesNoNextTurn(meter: Meter, { mostInputTokens }: TurnLimits): boolean {
  const turn = meter.last;
  if (turn === null) {
    return false;
  }
  const projected = turn.inputTokens + turn.outputTokens + meter.answeredBytes / turn.bytesPerToken;
  return mostInputTokens - meter.spentInputTokens - projected < projected;
}
