import { expressionScript } from './expression-script.ts';
import type { Evaluation, ProgramFailure, ProgramRun } from './program-run.ts';
import {
  sandboxRuntimeOf,
  type SandboxContext,
  type SandboxInstance,
  type SandboxSettings,
  type Settled,
} from './sandbox-session.ts';

export type FilterTest = (value: string, evaluation: Evaluation) => ProgramRun;

export type Fold = (event: string, evaluation: Evaluation) => ProgramRun;

export interface FilterContext {
  readonly define: (source: string) => FilterTest;
  readonly freeze: () => ProgramFailure | undefined;
  readonly close: () => void;
}

export type FoldingUnit =
  | { readonly refused: ProgramFailure; readonly close: () => void }
  | (FilterContext & { readonly fold: Fold });

export interface FoldingSource {
  readonly fold: string;
  readonly view: string;
}

const filterArgument = '$data';

const foldEntry = 'fold';

function raisedWith(detail: string, line: number | null): ProgramFailure {
  return { ran: 'raised', issue: { detail, line }, work: 0 };
}

function closing(context: SandboxContext, close: () => void): () => void {
  return () => {
    context.close();
    close();
  };
}

function keptOn(
  context: SandboxContext,
  evaluation: Evaluation,
  roots: readonly number[],
): Omit<FilterContext, 'close'> {
  const defined: number[] = [...roots];
  const state: { frozen: ProgramFailure | undefined } = { frozen: undefined };
  const definedTest = (settled: Settled): FilterTest => {
    if ('failed' in settled) {
      return () => settled.failed;
    }
    defined.push(settled.kept);
    return (value, testing) =>
      state.frozen ?? context.call({ fn: settled.kept, args: [value], form: 'expression' }, testing);
  };
  return {
    define: (source) => definedTest(context.expression(expressionScript(source, [filterArgument]), evaluation)),
    freeze: () => {
      const frozen = context.freeze(defined, evaluation);
      state.frozen = 'failed' in frozen ? frozen.failed : state.frozen;
      return state.frozen;
    },
  };
}

export function filterContextOf(
  instance: SandboxInstance,
  settings: SandboxSettings,
  evaluation: Evaluation,
): FilterContext {
  const runtime = sandboxRuntimeOf(instance, settings);
  const context = runtime.context(true);
  return { ...keptOn(context, evaluation, []), close: closing(context, runtime.close) };
}

type LoadedFold = { readonly namespace: number; readonly fold: number } | { readonly failed: ProgramFailure };

function loadedFold(context: SandboxContext, source: string, evaluation: Evaluation): LoadedFold {
  const namespace = context.module(source, evaluation);
  if ('failed' in namespace) {
    return namespace;
  }
  const fold = context.exported(namespace.kept, foldEntry);
  return fold === undefined
    ? { failed: raisedWith('The program exports no function fold', null) }
    : { namespace: namespace.kept, fold };
}

function foldingOf(context: SandboxContext, fold: number, view: number): Fold {
  const current = { view };
  return (event, evaluation) => {
    const run = context.call({ fn: fold, args: [current.view, event], form: 'module' }, evaluation);
    if (run.ran !== 'answered') {
      return run;
    }
    const next = context.parsedUncounted(run.text);
    if ('failed' in next) {
      return next.failed;
    }
    context.forget(current.view);
    current.view = next.kept;
    return run;
  };
}

export function foldingUnitOf(
  instance: SandboxInstance,
  settings: SandboxSettings,
  source: FoldingSource,
  evaluation: Evaluation,
): FoldingUnit {
  const runtime = sandboxRuntimeOf(instance, settings);
  const context = runtime.context(true);
  const close = closing(context, runtime.close);
  const loaded = loadedFold(context, source.fold, evaluation);
  if ('failed' in loaded) {
    return { refused: loaded.failed, close };
  }
  const view = context.parsed(source.view, evaluation);
  if ('failed' in view) {
    return { refused: view.failed, close };
  }
  return {
    ...keptOn(context, evaluation, [loaded.namespace]),
    fold: foldingOf(context, loaded.fold, view.kept),
    close,
  };
}
