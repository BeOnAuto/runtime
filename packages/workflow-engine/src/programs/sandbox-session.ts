import type { QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core';

import { oversizedBy, type Evaluation, type Form, type ProgramFailure, type ProgramRun } from './program-run.ts';
import { counterOf, type Counter } from './sandbox-counter.ts';
import { freezingPreludeSource, preludeSource } from './sandbox-prelude.ts';
import { vmOf, type Outcome, type Vm } from './sandbox-vm.ts';
import { expressionFile, failedBy, programFile, type Raised } from './thrown-errors.ts';

export interface SandboxInstance {
  readonly module: Readonly<QuickJSWASMModule>;
  readonly memoryBytes: number;
  readonly refusedGrowth: () => boolean;
  readonly release: (intact: boolean) => void;
}

export interface SandboxSettings {
  readonly stackBytes: number;
  readonly mostAnswerBytes: number;
  readonly clock: () => number;
}

type Argument = number | string;

interface Call {
  readonly fn: number;
  readonly args: readonly Argument[];
  readonly form: Form;
}

export type Settled = { readonly kept: number } | { readonly failed: ProgramFailure };

export interface SandboxContext {
  readonly module: (javascript: string, evaluation: Evaluation) => Settled;
  readonly exported: (namespace: number, name: string) => number | undefined;
  readonly expression: (javascript: string, evaluation: Evaluation) => Settled;
  readonly freeze: (roots: readonly number[], evaluation: Evaluation) => Settled;
  readonly parsed: (text: string, evaluation: Evaluation) => Settled;
  readonly parsedUncounted: (text: string) => Settled;
  readonly call: (call: Call, evaluation: Evaluation) => ProgramRun;
  readonly forget: (id: number) => void;
  readonly close: () => void;
}

export interface SandboxRuntime {
  readonly context: (freezes?: boolean) => SandboxContext;
  readonly broken: () => boolean;
  readonly close: () => void;
}

interface Prelude {
  readonly moment: number;
  readonly parse: number;
  readonly write: number;
  readonly freeze: number;
  readonly describe: number;
  readonly drain: number;
}

interface Session {
  readonly vm: Vm;
  readonly counter: Counter;
  readonly prelude: Prelude;
  readonly mostAnswerBytes: number;
}

const describingBudget = 16;

function preludeOf(vm: Vm, freezes: boolean): Prelude {
  const api = vm.loaded(freezes ? freezingPreludeSource : preludeSource, 'prelude.js');
  const named = (name: string): number => vm.property(api, name);
  return {
    moment: named('moment'),
    parse: named('parse'),
    write: named('write'),
    freeze: named('freeze'),
    describe: named('describe'),
    drain: named('drain'),
  };
}

function discarded({ vm, counter }: Session, outcome: Outcome): void {
  if ('thrown' in outcome) {
    counter.broke(outcome.thrown);
    return;
  }
  vm.forget('value' in outcome ? outcome.value : outcome.error);
}

function begin(session: Session, { budget, deadlineAt, moment }: Evaluation): void {
  const { vm, counter, prelude } = session;
  discarded(
    session,
    counter.drained(() => vm.call(prelude.drain, [])),
  );
  counter.begin({ budget, deadlineAt });
  const at = vm.number(moment);
  discarded(session, vm.call(prelude.moment, [at]));
  vm.forget(at);
}

function descriptionOf({ vm, counter, prelude }: Session, error: number): string | undefined {
  const outcome = counter.aside(describingBudget, () => vm.call(prelude.describe, [error]));
  vm.forget(error);
  return 'value' in outcome ? vm.takeText(outcome.value) : undefined;
}

function settled(session: Session, outcome: Outcome, raised: Raised): Settled {
  const { counter } = session;
  if ('thrown' in outcome) {
    return { failed: counter.broke(outcome.thrown) };
  }
  const ending = counter.ending();
  if (ending !== undefined) {
    discarded(session, outcome);
    return { failed: ending };
  }
  return 'error' in outcome
    ? { failed: failedBy(raised, descriptionOf(session, outcome.error), counter.checkpoints()) }
    : { kept: outcome.value };
}

function parsedArgument(session: Session, given: Argument): Settled {
  if (typeof given === 'number') {
    return { kept: given };
  }
  const { vm, prelude } = session;
  const raw = vm.text(given);
  const parsed = vm.call(prelude.parse, [raw]);
  vm.forget(raw);
  return settled(session, parsed, 'raised');
}

function parsedArguments(session: Session, args: readonly Argument[]): readonly number[] | ProgramFailure {
  const made: number[] = [];
  for (const given of args) {
    const next = parsedArgument(session, given);
    if ('failed' in next) {
      return next.failed;
    }
    made.push(next.kept);
  }
  return made;
}

function written(session: Session, value: number, form: Form): ProgramRun {
  const { vm, counter, prelude, mostAnswerBytes } = session;
  const formText = vm.text(form);
  const most = vm.number(mostAnswerBytes);
  const outcome = settled(session, vm.call(prelude.write, [value, formText, most]), 'unfit');
  vm.forget(formText);
  vm.forget(most);
  if ('failed' in outcome) {
    return outcome.failed;
  }
  if (vm.typeOf(outcome.kept) === 'number') {
    vm.forget(outcome.kept);
    return oversizedBy(mostAnswerBytes, counter.checkpoints());
  }
  return { ran: 'answered', text: vm.takeText(outcome.kept), work: counter.checkpoints() };
}

function answered(session: Session, kept: number, form: Form): ProgramRun {
  const run = written(session, kept, form);
  session.vm.forget(kept);
  return run;
}

function called(session: Session, call: Call, evaluation: Evaluation): ProgramRun {
  begin(session, evaluation);
  const values = parsedArguments(session, call.args);
  if ('ran' in values) {
    return values;
  }
  const outcome = settled(session, session.vm.call(call.fn, values), 'raised');
  values.forEach((value, index) => {
    if (typeof call.args[index] === 'string') {
      session.vm.forget(value);
    }
  });
  return 'failed' in outcome ? outcome.failed : answered(session, outcome.kept, call.form);
}

function guarded<Result>(counter: Counter, during: () => Result, failed: (failure: ProgramFailure) => Result): Result {
  try {
    return during();
  } catch (thrown) {
    return failed(counter.broke(thrown));
  }
}

function failedSettling(failure: ProgramFailure): Settled {
  return { failed: failure };
}

function failedCall(failure: ProgramFailure): ProgramRun {
  return failure;
}

function loaded(session: Session, evaluation: Evaluation, load: () => Outcome): Settled {
  return guarded(
    session.counter,
    () => {
      begin(session, evaluation);
      return settled(session, load(), 'raised');
    },
    failedSettling,
  );
}

function contextOf(
  runtime: () => QuickJSRuntime,
  counter: Counter,
  mostAnswerBytes: number,
  freezes: boolean,
): SandboxContext {
  const vm = vmOf(runtime);
  const session: Session = { vm, counter, prelude: counter.unbounded(() => preludeOf(vm, freezes)), mostAnswerBytes };
  return {
    module: (javascript, evaluation) => loaded(session, evaluation, () => vm.evaluate(javascript, programFile, true)),
    exported: (namespace, name) => {
      const found = vm.property(namespace, name);
      const isFunction = vm.typeOf(found) === 'function';
      if (!isFunction) {
        vm.forget(found);
      }
      return isFunction ? found : undefined;
    },
    expression: (javascript, evaluation) =>
      loaded(session, evaluation, () => vm.evaluate(javascript, expressionFile, false)),
    freeze: (roots, evaluation) => loaded(session, evaluation, () => vm.call(session.prelude.freeze, roots)),
    parsed: (text, evaluation) =>
      guarded(
        counter,
        () => {
          begin(session, evaluation);
          return parsedArgument(session, text);
        },
        failedSettling,
      ),
    parsedUncounted: (text) =>
      guarded(counter, () => counter.unbounded(() => parsedArgument(session, text)), failedSettling),
    call: (call, evaluation) => guarded(counter, () => called(session, call, evaluation), failedCall),
    forget: vm.forget,
    close: () => {
      if (!counter.broken()) {
        vm.close();
      }
    },
  };
}

export function sandboxRuntimeOf(instance: SandboxInstance, settings: SandboxSettings): SandboxRuntime {
  const runtime = instance.module.newRuntime();
  const counter = counterOf(instance.refusedGrowth, settings.clock);
  runtime.setMaxStackSize(settings.stackBytes);
  runtime.setInterruptHandler(counter.interrupt);
  return {
    context: (freezes = false) => contextOf(() => runtime, counter, settings.mostAnswerBytes, freezes),
    broken: counter.broken,
    close: () => {
      const intact = !counter.broken();
      if (intact) {
        runtime.dispose();
      }
      instance.release(intact);
    },
  };
}
