import type { RejectedCall } from '@on.auto/operations';

import type { Json, JsonObject } from './json.ts';
import type { Rejection } from './policy-checks.ts';

type ArgumentRejections = (arguments_: Json | undefined, pointer: string) => readonly Rejection[];

type CallDescription = (name: string, arguments_: Json) => string;

type RefusalWords = (name: string, arguments_: Json, rejected: RejectedCall) => string;

export interface ChildCall {
  readonly function: string;
  readonly reference: string;
  readonly run: number;
  readonly arguments: Json;
  readonly attributes: JsonObject;
}

export interface CallFunctions {
  readonly argumentChecks: Readonly<Record<string, ArgumentRejections>>;
  readonly describe: CallDescription;
  readonly refusal?: RefusalWords;
  readonly childOf?: (call: ChildCall) => string | undefined;
  readonly emitRejections?: (attributes: JsonObject, pointer: string) => readonly Rejection[];
  readonly emitRefusal?: (event: JsonObject) => string | undefined;
  readonly outputRefusal?: (document: JsonObject, output: Json) => string | undefined;
  readonly scheduleRejections?: (schedule: Json, pointer: string) => readonly Rejection[];
  readonly howAWorkflowReachesTheWorld: string;
  readonly howAWorkflowStarts: string;
}

export function namesOf({ argumentChecks }: CallFunctions): string {
  return Object.keys(argumentChecks).join(', ');
}

export function theFunctions(functions: CallFunctions): string {
  return Object.keys(functions.argumentChecks).length === 1
    ? `the one function is ${namesOf(functions)}`
    : `the functions are ${namesOf(functions)}`;
}
