import type { Digested } from '@on.auto/content';
import type { CallLink, RecordedCaller, StartingTrigger } from '@on.auto/operations';
import { payloadMembers, type Payload, type PayloadArm } from '@on.auto/operations/payloads';
import type { Schema } from 'effect';

import type { ValuesRead } from '../payloads/payload-comparisons.ts';
import type { OutputShapeName } from '../shapes/shape-names.ts';
import type {
  AnswerBeside,
  CancelRequestKind,
  ModelCallEndedFact,
  ModelCallStarted,
  RunDeferred,
  RunEvent,
  RunFinished,
  ToolCallEnded,
  ToolCallStarted,
} from './run-events.ts';

interface ComparedWithWhatWasRead {
  readonly valuesRead?: ValuesRead;
}

export interface RunRequest extends ComparedWithWhatWasRead {
  readonly definition_type: string;
  readonly name: string;
  readonly input: Schema.Json;
}

export interface RunAsked extends ComparedWithWhatWasRead {
  readonly definition_type: string;
  readonly name: string;
  readonly input: Payload<Schema.Json>;
}

export function askedOf({ definition_type, name, input, valuesRead }: RunRequest): RunAsked {
  return { definition_type, name, input: { inline: input }, ...(valuesRead === undefined ? {} : { valuesRead }) };
}

export interface RunStart extends RunRequest {
  readonly type: 'start';
  readonly started_by: RecordedCaller;
  readonly definition_version: number;
  readonly calls_tools: boolean;
  readonly finishes_later?: boolean;
  readonly output_shape?: OutputShapeName;
  readonly depth?: number;
  readonly call_depth?: number;
  readonly called_by?: CallLink;
  readonly trigger?: StartingTrigger;
  readonly acts_for?: string;
  readonly createOnly?: true;
  readonly resumes?: true;
  readonly inputKept?: Digested;
}

function inputAsWritten({ input, inputKept }: RunStart): Payload<Schema.Json> {
  return inputKept === undefined ? { inline: input } : { kept: inputKept };
}

export function startedEvent(start: RunStart): RunEvent {
  const { started_by, calls_tools, finishes_later, resumes, output_shape } = start;
  return {
    type: 'run_started',
    data: {
      ...payloadMembers('input', inputAsWritten(start)),
      started_by,
      ...(calls_tools ? { calls_tools } : {}),
      ...(finishes_later === true ? { finishes_later } : {}),
      ...(resumes === true ? { resumes } : {}),
      ...(output_shape === undefined ? {} : { output_shape }),
    },
  };
}

export type RunResult = RunFinished;

export type RunOutcome = RunFinished | RunDeferred;

export type CallStartedFact = Omit<ToolCallStarted, 'data'> & {
  readonly data: Omit<ToolCallStarted['data'], 'number'> & { readonly number?: number };
};

export type ToolCallFact = CallStartedFact | ToolCallEnded;

export type ModelCallFact = ModelCallStarted | ModelCallEndedFact;

export type CallFact = ToolCallFact | ModelCallFact;

export interface CapabilityFact {
  readonly type: string;
  readonly data: Schema.JsonObject;
}

export type AnswerFact = AnswerBeside & PayloadArm<'answer', Schema.Json>;

export type GivenAnswer = Omit<AnswerBeside, 'answered_by'> & { readonly answer: Schema.Json };

export interface InterruptedAttempt {
  readonly type: 'run_interrupted';
  readonly resumes?: true;
  readonly record?: Schema.JsonObject;
}

export const firstAttempt = 1;

export interface RunFinish {
  readonly type: 'finish';
  readonly result: RunOutcome | InterruptedAttempt;
  readonly attempt?: number;
}

export interface RunResume {
  readonly type: 'resume';
  readonly attempt: number;
}

export interface RunCall {
  readonly type: 'call';
  readonly fact: CallFact;
}

export interface RunWork {
  readonly type: 'work';
  readonly fact: CapabilityFact;
}

export interface RunAnswer extends ComparedWithWhatWasRead {
  readonly type: 'answer';
  readonly answer: AnswerFact;
}

interface CommandMetadata {
  readonly runId: string;
  readonly by: string;
  readonly at: string;
}

export interface RunSettlement extends CommandMetadata, ComparedWithWhatWasRead {
  readonly type: 'settle';
  readonly result: RunResult;
}

export interface RunCancel extends CommandMetadata {
  readonly type: 'cancel';
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly byItsCaller?: true;
  readonly attemptDied?: true;
}

export type RunCommand =
  | ((RunStart | RunFinish | RunResume | RunCall | RunWork | RunAnswer) & CommandMetadata)
  | RunSettlement
  | RunCancel;
