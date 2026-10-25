import type { CallLink, StartingTrigger } from '@on.auto/operations';
import type { Schema } from 'effect';

import type { OutputShapeName } from '../shapes/shape-names.ts';
import type {
  CancelRequestKind,
  ModelCallEndedFact,
  ModelCallStarted,
  RequestAnswered,
  RunDeferred,
  RunFinished,
  ToolCallEnded,
  ToolCallStarted,
} from './run-events.ts';

export interface RunRequest {
  readonly definition_type: string;
  readonly name: string;
  readonly input: Schema.Json;
}

export interface RunStart extends RunRequest {
  readonly type: 'start';
  readonly definition_version: number;
  readonly calls_tools: boolean;
  readonly finishes_later?: boolean;
  readonly output_shape?: OutputShapeName;
  readonly depth?: number;
  readonly call_depth?: number;
  readonly called_by?: CallLink;
  readonly trigger?: StartingTrigger;
  readonly createOnly?: true;
  readonly resumes?: true;
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

export type AnswerFact = RequestAnswered['data'];

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

export interface RunAnswer {
  readonly type: 'answer';
  readonly answer: AnswerFact;
}

interface CommandMetadata {
  readonly runId: string;
  readonly by: string;
  readonly at: string;
}

export interface RunSettlement extends CommandMetadata {
  readonly type: 'settle';
  readonly result: RunResult;
}

export interface RunCancel extends CommandMetadata {
  readonly type: 'cancel';
  readonly kind: CancelRequestKind;
  readonly reason: string;
  readonly byItsCaller?: true;
}

export type RunCommand =
  | ((RunStart | RunFinish | RunResume | RunCall | RunWork | RunAnswer) & CommandMetadata)
  | RunSettlement
  | RunCancel;
