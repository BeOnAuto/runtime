import type { CallLink, Context, StartingTrigger } from '@on.auto/operations';

import type { RunCommand, RunStart } from './run-commands.ts';
import { startedRunOf, type RecordedRunState, type RunStreamState } from './run-state.ts';

type Chain = Omit<Context, 'at' | 'by' | 'runId'>;

interface ChainLinks {
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy: Context['calledBy'];
  readonly trigger: StartingTrigger | undefined;
}

function linksOf({ depth, callDepth, calledBy, trigger }: ChainLinks): Chain {
  return {
    ...(calledBy === undefined ? {} : { calledBy }),
    ...(callDepth > 0 ? { callDepth } : {}),
    ...(depth > 0 ? { depth } : {}),
    ...(trigger === undefined ? {} : { trigger }),
  };
}

function calledByOf(link: CallLink | undefined): Context['calledBy'] {
  return link === undefined ? undefined : { runId: link.run_id, reference: link.reference, run: link.run };
}

function chainOfTheStart(start: RunStart): Chain {
  const { definition_type: definitionType, name, definition_version: definitionVersion } = start;
  return {
    definitionType,
    definitionName: name,
    definitionVersion,
    ...linksOf({
      depth: start.depth ?? 0,
      callDepth: start.call_depth ?? 0,
      calledBy: calledByOf(start.called_by),
      trigger: start.trigger,
    }),
  };
}

function chainOfTheRun({ run, depth, callDepth, calledBy, trigger }: RecordedRunState): Chain {
  return {
    definitionType: run.type,
    definitionName: run.name,
    definitionVersion: run.definition_version,
    ...linksOf({ depth, callDepth, calledBy, trigger }),
  };
}

function chainOf(command: RunCommand, state: RunStreamState): Chain {
  if (command.type === 'start') {
    return chainOfTheStart(command);
  }
  const run = startedRunOf(state);
  return run === undefined ? {} : chainOfTheRun(run);
}

export function runContextOf(command: RunCommand, state: RunStreamState): Context {
  const { at, by, runId } = command;
  return { at, by, runId, ...chainOf(command, state) };
}
