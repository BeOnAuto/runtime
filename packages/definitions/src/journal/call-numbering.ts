import { Conflict } from '@on.auto/operations';
import { Result } from 'effect';

import type { CallFact } from '../runs/run-commands.ts';
import type { RecordedCallFact } from '../runs/run-events.ts';

export interface CallNumbering {
  readonly lastCall: number;
  readonly lastModelCall: number;
  readonly openCalls: ReadonlySet<number>;
  readonly openModelCalls: ReadonlySet<number>;
}

export function numberingFrom(lastCall: number, lastModelCall: number): CallNumbering {
  return { lastCall, lastModelCall, openCalls: new Set(), openModelCalls: new Set() };
}

interface Kind {
  readonly noun: string;
  readonly last: number;
  readonly open: ReadonlySet<number>;
}

type CallStart = Extract<CallFact, { readonly type: 'tool_call_started' | 'model_call_started' }>;

export type CallEnd = Exclude<CallFact, CallStart>;

export function isCallStart(fact: CallFact): fact is CallStart {
  return fact.type === 'tool_call_started' || fact.type === 'model_call_started';
}

function kindOf({ type }: CallFact, numbering: CallNumbering): Kind {
  return type.startsWith('model_call')
    ? { noun: 'model call', last: numbering.lastModelCall, open: numbering.openModelCalls }
    : { noun: 'call', last: numbering.lastCall, open: numbering.openCalls };
}

function notTheNext({ noun, last }: Kind, number: number): Conflict {
  return new Conflict({
    detail: `The run records its ${noun}s in order, and ${noun} ${number} is not its next ${noun}, ${last + 1}; another attempt recorded it first`,
    kind: 'taken',
  });
}

function notOpen({ noun }: Kind, number: number): Conflict {
  return new Conflict({
    detail: `The run's ${noun} ${number} is not open, so it takes no end: another attempt ended it, or it never started`,
    kind: 'taken',
  });
}

function startNumbered(kind: Kind, number: number): Result.Result<number, Conflict> {
  return number === kind.last + 1 ? Result.succeed(number) : Result.fail(notTheNext(kind, number));
}

export function numberedCall(numbering: CallNumbering, fact: CallFact): Result.Result<RecordedCallFact, Conflict> {
  const kind = kindOf(fact, numbering);
  if (fact.type === 'tool_call_started') {
    return Result.map(startNumbered(kind, fact.data.number ?? kind.last + 1), (number) => ({
      type: fact.type,
      data: { ...fact.data, number },
    }));
  }
  if (fact.type === 'model_call_started') {
    return Result.map(startNumbered(kind, fact.data.number), () => fact);
  }
  return kind.open.has(fact.data.number) ? Result.succeed(fact) : Result.fail(notOpen(kind, fact.data.number));
}

function opened(open: ReadonlySet<number>, number: number): ReadonlySet<number> {
  return new Set([...open, number]);
}

function closed(open: ReadonlySet<number>, number: number): ReadonlySet<number> {
  return new Set([...open].filter((each) => each !== number));
}

export function numberingAfter(numbering: CallNumbering, { type, data: { number } }: RecordedCallFact): CallNumbering {
  const { lastCall, lastModelCall, openCalls, openModelCalls } = numbering;
  if (type === 'tool_call_started') {
    return { lastCall: number, lastModelCall, openCalls: opened(openCalls, number), openModelCalls };
  }
  if (type === 'model_call_started') {
    return { lastCall, lastModelCall: number, openCalls, openModelCalls: opened(openModelCalls, number) };
  }
  return type.startsWith('model_call')
    ? { lastCall, lastModelCall, openCalls, openModelCalls: closed(openModelCalls, number) }
    : { lastCall, lastModelCall, openCalls: closed(openCalls, number), openModelCalls };
}
