import { nestedRunId, type RunEnding } from '@on.auto/definitions';
import { invalidArguments, type CallResult } from '@on.auto/operations';
import { jsonBytesOf } from '@on.auto/workflow-engine';
import { recordIdOf, type CallAnswer, type Perform } from '@on.auto/workflow-host';
import { Effect, Option } from 'effect';

import { isArgumentsProblem, definitionArgumentsOf } from '../document/definition-arguments.ts';
import { attributesOfRun } from '../runs/run-attributes.ts';
import { endedRunResultOf } from './function-results.ts';
import type { DefinitionRunResult, EndedRunResult, RunDefinition } from './function-run.ts';

const mostDefinitionOutputBytes = 1_048_576;

const noCaller: CallAnswer = {
  status: 'failed',
  detail: 'The run names no playbook and no caller to run a definition for',
};

function callResultOf(result: EndedRunResult): CallResult {
  if (result.status === 'rejected') {
    const { reason, detail, kind, because, issues } = result;
    return {
      status: 'rejected',
      reason,
      detail,
      ...(kind === undefined ? {} : { kind }),
      ...(because === undefined ? {} : { because }),
      ...(issues === undefined ? {} : { issues }),
    };
  }
  if (result.status === 'failed') {
    return result;
  }
  const bytes = jsonBytesOf(result.output);
  return bytes > mostDefinitionOutputBytes
    ? {
        status: 'failed',
        detail: `The run returned ${bytes} bytes as JSON, more than the ${mostDefinitionOutputBytes} a workflow takes`,
      }
    : result;
}

export function callResultOfEnding(ending: RunEnding): CallResult {
  return callResultOf(endedRunResultOf(ending));
}

function callAnswerOf(result: DefinitionRunResult, child: string): CallAnswer {
  return result.status === 'waiting' ? { status: 'waiting', child } : callResultOf(result);
}

export function definitionCalls(runDefinition: RunDefinition): Perform {
  return (call, run, origin, { attemptDied }) =>
    Option.match(attributesOfRun(run.attributes), {
      onNone: () => Effect.succeed(noCaller),
      onSome: ({ org, playbook, run_id: workflowRun, caller, lineage, depth = 0, call_depth = 0 }) => {
        const definition = definitionArgumentsOf(call.arguments);
        if (isArgumentsProblem(definition)) {
          return Effect.succeed<CallAnswer>({ status: 'rejected', reason: invalidArguments, detail: definition.title });
        }
        const { reference, run: count } = call.key;
        const runId = nestedRunId(workflowRun, reference, count);
        const startedBy = recordIdOf(run.runId, origin.version);
        const correlationId = lineage?.correlation ?? workflowRun;
        return runDefinition({
          org,
          playbook,
          caller,
          ...definition,
          runId,
          lineage: { causationId: startedBy, correlationId },
          depth,
          callDepth: call_depth + 1,
          calledBy: { run_id: workflowRun, reference, run: count },
          longestMs: call.longestMs,
          ...(attemptDied ? { attemptDied } : {}),
        }).pipe(Effect.map((result) => callAnswerOf(result, runId)));
      },
    });
}
