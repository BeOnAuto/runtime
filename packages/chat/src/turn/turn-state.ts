import type { ToolDefinition } from '@on.auto/reasoning';

import type { ChatModel, ConversationMessage } from '../model/chat-model.ts';
import type { DirectoryCalls } from '../tools/directory-calls.ts';
import { racedWith, type Waits } from './call-bounds.ts';
import type { TurnBounds } from './turn-bounds.ts';
import type { InputSpent } from './turn-input.ts';
import { toolCallsSentIn, type TurnStep } from './turn-steps.ts';

export const THROWN = 'thrown';

export type Admission = boolean | 'credential_expired';

export interface Turn<Refused> {
  readonly id: string;
  readonly instructions: string;
  readonly messages: readonly ConversationMessage[];
  readonly model: ChatModel<Refused>;
  readonly offered: readonly ToolDefinition[];
  readonly tools: Pick<DirectoryCalls, 'call'>;
  readonly admitted: () => Promise<Admission>;
  readonly now: () => number;
  readonly closed: () => boolean;
  readonly signal: Readonly<AbortSignal>;
  readonly waits: Waits;
  readonly bounds?: Partial<TurnBounds>;
}

export interface Spent {
  readonly modelCalls: number;
  readonly toolCalls: number;
}

export type TurnRefusal = 'bound_reached' | 'model_unavailable' | 'not_admitted' | 'credential_expired';

export type Ending<Refused> =
  | { readonly answer: string; readonly bounded: boolean }
  | { readonly refused: TurnRefusal | Refused; readonly failure?: string }
  | { readonly closed: true };

export type TurnEnded<Refused> = Spent & Ending<Refused>;

export interface BoundedTurn<Refused> extends Turn<Refused> {
  readonly bounds: TurnBounds;
}

export interface Running {
  readonly steps: readonly TurnStep[];
  readonly modelCalls: number;
  readonly spent: InputSpent;
  readonly startedAt: number | undefined;
}

export type Stepped<Refused> = { readonly ended: TurnEnded<Refused> } | { readonly running: Running };

const spentIn = ({ steps, modelCalls }: Running): Spent => ({ modelCalls, toolCalls: toolCallsSentIn(steps) });

export const endedWith = <Refused>(running: Running, ending: Ending<Refused>): TurnEnded<Refused> => ({
  ...spentIn(running),
  ...ending,
});

export const thrownFrom = <Refused>(running: Running): Stepped<Refused> => ({
  ended: endedWith(running, { refused: 'model_unavailable', failure: THROWN }),
});

const isPastTheDeadline = <Refused>(turn: BoundedTurn<Refused>, startedAt: number | undefined): boolean =>
  startedAt !== undefined && turn.now() - startedAt >= turn.bounds.turnMs;

const timeLeftOf = <Refused>(turn: BoundedTurn<Refused>, startedAt: number): number =>
  startedAt + turn.bounds.turnMs - turn.now();

type Bounded<A> =
  | { readonly settled: A; readonly byTheDeadline: boolean }
  | { readonly ended: Ending<never> }
  | { readonly capped: true };

export async function boundedBy<Refused, A>(
  turn: BoundedTurn<Refused>,
  startedAt: number,
  cap: number,
  start: (signal: Readonly<AbortSignal>, ms: number) => Promise<A>,
): Promise<Bounded<A>> {
  const left = timeLeftOf(turn, startedAt);
  const ms = Math.max(1, Math.floor(Math.min(cap, left)));
  const own = new AbortController();
  const raced = await racedWith(start(AbortSignal.any([turn.signal, own.signal]), ms), ms, turn);
  const byTheDeadline = left <= cap;
  if ('settled' in raced) {
    return { settled: raced.settled, byTheDeadline };
  }
  own.abort();
  if (raced.stopped === 'closed') {
    return { ended: { closed: true } };
  }
  return byTheDeadline ? { ended: { refused: 'bound_reached' } } : { capped: true };
}

export function stoppedBeforeACall<Refused>(
  turn: BoundedTurn<Refused>,
  startedAt: number | undefined,
): Ending<never> | undefined {
  if (turn.closed()) {
    return { closed: true };
  }
  return isPastTheDeadline(turn, startedAt) ? { refused: 'bound_reached' } : undefined;
}
