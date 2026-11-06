import type { ModelRequest, RunRoom } from '../model/model-request.ts';
import type { ModelTarget } from '../model/model-resolution.ts';
import type { RepairSkippedBecause } from '../model/model-result.ts';
import { issuesToTell, repairWords } from '../schema/repair-words.ts';
import {
  correctedOf,
  isAnswer,
  isRepairable,
  issuesOf,
  RepairFailed,
  settledAnswer,
  type CallMode,
  type Generated,
  type SettledAnswer,
  type UnreadAnswer,
} from './answer-settling.ts';

interface Repairing {
  readonly answer: string;
  readonly words: string;
}

export interface Asking {
  readonly repairing?: Repairing;
}

export interface JsonAsk {
  readonly ask: (asking: Asking) => Promise<UnreadAnswer>;
  readonly mode: CallMode;
}

interface RepairTokens {
  readonly first: number;
  readonly asked: number;
  readonly answer: number;
}

const utf8 = new TextEncoder();

function bytesOf(text: string): number {
  return utf8.encode(text).byteLength;
}

function repairTokensOf({ usage, requestBytes, text }: Generated, words: string): RepairTokens | undefined {
  const first = usage.input.total;
  if (first === null) {
    return undefined;
  }
  const tokensPerByte = first / Math.max(1, requestBytes);
  const answer = Math.ceil(bytesOf(text) * tokensPerByte);
  return { first, asked: first + answer + Math.ceil(bytesOf(words) * tokensPerByte), answer };
}

function tokensShort(room: RunRoom, { first, asked, answer }: RepairTokens): RepairSkippedBecause | undefined {
  if (first + asked > room.input_tokens) {
    return 'input_tokens';
  }
  return room.context_window !== undefined && asked + answer > room.context_window ? 'context_window' : undefined;
}

interface Timing {
  readonly began: number;
  readonly answered: number;
}

function msLeftAt({ timeout_ms: timeoutMs, room }: ModelRequest, { began, answered }: Timing): number {
  const deadline = timeoutMs === undefined ? Number.POSITIVE_INFINITY : began + timeoutMs;
  return Math.min(deadline, room?.ends_at ?? Number.POSITIVE_INFINITY) - answered;
}

function skippedBecause(
  request: ModelRequest,
  first: Generated,
  words: string,
  timing: Timing,
): RepairSkippedBecause | undefined {
  const tokens = repairTokensOf(first, words);
  const short = request.room === undefined || tokens === undefined ? undefined : tokensShort(request.room, tokens);
  if (short !== undefined) {
    return short;
  }
  return msLeftAt(request, timing) < timing.answered - timing.began ? 'time' : undefined;
}

export async function answerRepairedOnce(
  target: ModelTarget,
  request: ModelRequest,
  { ask, mode }: JsonAsk,
): Promise<SettledAnswer> {
  const began = Date.now();
  const first = await ask({});
  const answered = Date.now();
  if (!isRepairable(first.generated, first.output)) {
    return settledAnswer(target, first.generated, first.output, mode);
  }
  const issues = issuesToTell(issuesOf(first.output));
  const words = repairWords(issues);
  const because = skippedBecause(request, first.generated, words, { began, answered });
  if (because !== undefined) {
    return settledAnswer(target, first.generated, first.output, { ...mode, repair: { outcome: 'skipped', because } });
  }
  const unrepaired = { generated: first.generated, output: first.output, mode, issues, askedAt: answered };
  const second = await ask({ repairing: { answer: first.generated.text, words } }).catch((cause: unknown) => {
    throw new RepairFailed(unrepaired, cause);
  });
  const outcome: 'repaired' | 'invalid' = isAnswer(second.generated, second.output) ? 'repaired' : 'invalid';
  const repair = {
    outcome,
    issues,
    usage: second.generated.usage,
    ...second.generated.cost,
    duration_ms: Date.now() - answered,
  };
  return settledAnswer(target, correctedOf(first.generated, second.generated), second.output, { ...mode, repair });
}
