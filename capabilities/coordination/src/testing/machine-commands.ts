import type { CallResult } from '@on.auto/operations';
import type { CallKey, Json, RunOutput } from '@on.auto/workflow-engine';
import type { Dispatched } from '@on.auto/workflow-engine/testing';

import { failureChain, isArgumentsProblem, definitionArgumentsOf } from '../document/definition-arguments.ts';
import type { Command } from './machine-host.ts';
import type { DefinitionCall, DefinitionCallResult, WorkflowRun } from './run-terms.ts';

export type DefinitionResponder = (call: DefinitionCall) => DefinitionCallResult | Promise<DefinitionCallResult>;

function definitionCallOf(run: WorkflowRun, arguments_: Json, key: CallKey): DefinitionCall | CallResult {
  const definition = definitionArgumentsOf(arguments_);
  if (isArgumentsProblem(definition)) {
    return { status: 'rejected', reason: 'invalid_arguments', detail: definition.title };
  }
  const { org, playbook } = run.run;
  return { org, playbook, caller: run.caller, reference: key.reference, run: key.run, ...definition };
}

function isDefinitionCall(value: DefinitionCall | CallResult): value is DefinitionCall {
  return 'reference' in value;
}

export function answerOf(
  run: WorkflowRun,
  respond: DefinitionResponder,
  key: CallKey,
  arguments_: Json,
): Promise<CallResult> {
  const call = definitionCallOf(run, arguments_, key);
  if (!isDefinitionCall(call)) {
    return Promise.resolve(call);
  }
  return Promise.resolve(call)
    .then(respond)
    .then(
      (result): CallResult => result,
      (error: unknown): CallResult => ({ status: 'unreachable', detail: failureChain(error) }),
    );
}

function armCommand(
  labels: Map<string, string>,
  output: Extract<RunOutput, { readonly kind: 'arm_timer' }>,
  at: number,
): readonly Command[] {
  if (output.purpose === 'deadline') {
    return [{ kind: 'deadline', milliseconds: output.dueAt - at }];
  }
  const summary = output.purpose === 'call_deadline' ? undefined : output.label;
  if (summary === undefined) {
    return [];
  }
  labels.set(output.timerId, summary);
  return [{ kind: 'timer', milliseconds: output.dueAt - at, summary }];
}

function commandOf(run: WorkflowRun, labels: Map<string, string>, { at, output }: Dispatched): readonly Command[] {
  if (output.kind === 'arm_timer') {
    return armCommand(labels, output, at);
  }
  if (output.kind === 'cancel_timer') {
    const summary = labels.get(output.timerId);
    return summary === undefined ? [] : [{ kind: 'cancelled', summary }];
  }
  if (output.kind === 'start_call') {
    const call = definitionCallOf(run, output.arguments, output.key);
    return isDefinitionCall(call) ? [{ kind: 'call', call }] : [];
  }
  if (output.kind === 'cancel_call') {
    return [{ kind: 'cancelled', summary: output.key.reference }];
  }
  if (output.kind === 'emit_event') {
    return [{ kind: 'emitted', event: output.event }];
  }
  if (output.kind !== 'settle') {
    return [];
  }
  const { org, playbook, id, definition } = run.run;
  return [
    {
      kind: 'settle',
      request: { org, playbook, definition: definition.name, runId: id, settlement: output.settlement },
    },
  ];
}

export function commandsOf(run: WorkflowRun, dispatched: readonly Dispatched[]): readonly Command[] {
  const labels = new Map<string, string>();
  return dispatched.flatMap((entry) => commandOf(run, labels, entry));
}
