import type { Evaluation, ProgramFailure, ProgramIssue, ProgramRun } from './program-run.ts';
import { sandboxRuntimeOf, type SandboxInstance, type SandboxSettings } from './sandbox-session.ts';

export interface ModuleRequest {
  readonly source: string;
  readonly entry: string;
  readonly arguments: readonly string[];
  readonly evaluation: Evaluation;
}

export type ModuleRun = ProgramRun | { readonly ran: 'refused'; readonly issue: ProgramIssue };

function loadFailure(failed: ProgramFailure): ModuleRun {
  return failed.ran === 'raised' ? { ran: 'refused', issue: failed.issue } : failed;
}

export function moduleRun(instance: SandboxInstance, settings: SandboxSettings, request: ModuleRequest): ModuleRun {
  const runtime = sandboxRuntimeOf(instance, settings);
  const context = runtime.context();
  try {
    const loaded = context.module(request.source, request.evaluation);
    if ('failed' in loaded) {
      return loadFailure(loaded.failed);
    }
    const fn = context.exported(loaded.kept, request.entry);
    return fn === undefined
      ? { ran: 'refused', issue: { detail: `The program exports no function ${request.entry}`, line: null } }
      : context.call({ fn, args: request.arguments, form: 'module' }, request.evaluation);
  } finally {
    context.close();
    runtime.close();
  }
}
