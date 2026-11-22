import { Schema } from 'effect';

import type { ToolReply } from '../tools/directory-calls.ts';
import { MOST_TOOL_CALLS } from './turn-bounds.ts';
import {
  boundedBy,
  endedWith,
  stoppedBeforeACall,
  type Admission,
  type BoundedTurn,
  type Ending,
  type Running,
  type Stepped,
} from './turn-state.ts';
import type { AnsweredCall, Asked, AskedCall } from './turn-steps.ts';

export const NOT_AN_OBJECT = 'The arguments of this call are not a JSON object, so it was not sent; send an object.';

export const overTheBound = (toolCalls: number): string =>
  `This turn may make ${toolCalls} tool calls and has made them, so this call was not sent.`;

export const OVER_THE_BOUND = overTheBound(MOST_TOOL_CALLS);

export const NOT_CALLED = 'The tool could not be called';

export const TOOL_TIMED_OUT =
  'The tool did not answer in time, so its call was given up; try something else or answer without it.';

const isArguments = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

const endingOfAn = (admission: Admission): Ending<never> | undefined => {
  if (admission === true) {
    return undefined;
  }
  return { refused: admission === false ? 'not_admitted' : admission };
};

async function admissionChecked<Refused>(
  turn: BoundedTurn<Refused>,
  startedAt: number,
): Promise<Ending<never> | undefined> {
  try {
    const checked = await boundedBy(turn, startedAt, turn.bounds.toolCallMs, () => turn.admitted());
    if ('ended' in checked) {
      return checked.ended;
    }
    if ('capped' in checked) {
      return { refused: 'not_admitted' };
    }
    return endingOfAn(checked.settled);
  } catch {
    return { refused: 'not_admitted' };
  }
}

async function replyTo<Refused>(
  turn: BoundedTurn<Refused>,
  startedAt: number,
  asked: AskedCall,
): Promise<ToolReply | Ending<never>> {
  const { input } = asked;
  if (!isArguments(input)) {
    return { text: NOT_AN_OBJECT, isError: true };
  }
  try {
    const called = await boundedBy(turn, startedAt, turn.bounds.toolCallMs, (signal) =>
      turn.tools.call(asked.tool, input, signal),
    );
    if ('ended' in called) {
      return called.ended;
    }
    return 'capped' in called ? { text: TOOL_TIMED_OUT, isError: true } : called.settled;
  } catch {
    return { text: NOT_CALLED, isError: true };
  }
}

async function stoppedBeforeATool<Refused>(
  turn: BoundedTurn<Refused>,
  startedAt: number,
  asked: AskedCall,
): Promise<Ending<never> | undefined> {
  if (!isArguments(asked.input)) {
    return undefined;
  }
  return stoppedBeforeACall(turn, startedAt) ?? (await admissionChecked(turn, startedAt));
}

export interface Calling<Refused> {
  readonly turn: BoundedTurn<Refused>;
  readonly running: Running;
  readonly startedAt: number;
  readonly asked: Asked;
  readonly room: number;
}

const withStep = <Refused>({ running, asked, room }: Calling<Refused>, answered: readonly AnsweredCall[]): Running => ({
  ...running,
  steps: [
    ...running.steps,
    { assistant: asked.assistant, said: asked.said, calls: answered, sent: Math.min(room, answered.length) },
  ],
});

const pastTheBound = <Refused>({ turn, asked, room }: Calling<Refused>): readonly AnsweredCall[] =>
  asked.calls
    .slice(room)
    .map((call) => ({ asked: call, reply: { text: overTheBound(turn.bounds.toolCalls), isError: true } }));

export async function callsFrom<Refused>(
  calling: Calling<Refused>,
  answered: readonly AnsweredCall[],
): Promise<Stepped<Refused>> {
  const call = calling.asked.calls[answered.length];
  if (call === undefined || answered.length >= calling.room) {
    return { running: withStep(calling, [...answered, ...pastTheBound(calling)]) };
  }
  const stopped = await stoppedBeforeATool(calling.turn, calling.startedAt, call);
  if (stopped !== undefined) {
    return { ended: endedWith(withStep(calling, answered), stopped) };
  }
  const replied = await replyTo(calling.turn, calling.startedAt, call);
  if (!('text' in replied)) {
    const notCalled = { asked: call, reply: { text: NOT_CALLED, isError: true } };
    return { ended: endedWith(withStep(calling, [...answered, notCalled]), replied) };
  }
  return callsFrom(calling, [...answered, { asked: call, reply: replied }]);
}
