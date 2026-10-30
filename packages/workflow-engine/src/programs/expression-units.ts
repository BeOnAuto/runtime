import type { Json } from '../dsl/json.ts';
import { expressionScript } from './expression-script.ts';
import { exhaustedBy, type Evaluation, type ProgramRun } from './program-run.ts';
import {
  sandboxRuntimeOf,
  type SandboxInstance,
  type SandboxRuntime,
  type SandboxSettings,
} from './sandbox-session.ts';

export type Arguments = Readonly<Record<string, Json>>;

export interface NamedArguments {
  readonly names: readonly string[];
  readonly texts: readonly string[];
}

export interface ExpressionUnit {
  readonly evaluate: (source: string, values: Arguments, evaluation: Evaluation) => ProgramRun;
  readonly close: () => void;
}

export interface OpenedUnit extends ExpressionUnit {
  readonly evaluateNamed: (source: string, named: NamedArguments, evaluation: Evaluation) => ProgramRun;
  readonly took: () => boolean;
}

interface Opened {
  readonly instance: SandboxInstance;
  readonly runtime: SandboxRuntime;
}

const argumentName = /\$[A-Za-z_][\w$]*/gu;

export function namedArguments(source: string, values: Arguments): NamedArguments {
  const named = new Set(source.match(argumentName));
  const names = Object.keys(values).filter((name) => named.has(`$${name}`));
  return { names, texts: names.map((name) => JSON.stringify(values[name])) };
}

export function expressionUnitOf(instances: () => SandboxInstance, settings: SandboxSettings): OpenedUnit {
  const opened: { current?: Opened } = {};
  const openedNow = (): Opened => {
    if (opened.current === undefined) {
      const instance = instances();
      opened.current = { instance, runtime: sandboxRuntimeOf(instance, settings) };
    }
    return opened.current;
  };
  const evaluateNamed = (source: string, { names, texts }: NamedArguments, evaluation: Evaluation): ProgramRun => {
    const { instance, runtime } = openedNow();
    if (instance.refusedGrowth() || runtime.broken()) {
      return exhaustedBy(instance.refusedGrowth() ? 'memory' : 'stack', 0);
    }
    const context = runtime.context();
    try {
      const loaded = context.expression(
        expressionScript(
          source,
          names.map((name) => `$${name}`),
        ),
        evaluation,
      );
      return 'failed' in loaded
        ? loaded.failed
        : context.call({ fn: loaded.kept, args: texts, form: 'expression' }, evaluation);
    } finally {
      context.close();
    }
  };
  return {
    evaluate: (source, values, evaluation) => evaluateNamed(source, namedArguments(source, values), evaluation),
    evaluateNamed,
    took: () => opened.current !== undefined,
    close: () => {
      opened.current?.runtime.close();
    },
  };
}
