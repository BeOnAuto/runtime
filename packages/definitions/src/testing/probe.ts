import { compileJsonSchema } from '@on.auto/json-schema';
import { Conflict, InvalidInput, Unavailable } from '@on.auto/operations';
import { mostValueDepth } from '@on.auto/workflow-engine';
import { Effect, Predicate, Result, type Schema } from 'effect';

import {
  checkedInput,
  defineCapability,
  type CapabilityAnswer,
  type RunContext,
  type Capability,
  type CapabilityRejection,
} from '../index.ts';

type Mishap =
  | 'stall'
  | 'unavailable'
  | 'unoffered'
  | 'conflict'
  | 'unworkable'
  | 'unknown'
  | 'breakdown'
  | 'spent'
  | 'overspent';

export const spentUsage = {
  input: { total: 120, uncached: 30, cache_read: 90, cache_write: 0 },
  output: { total: 40 },
};

export interface Probe {
  readonly capability: Capability;
  readonly runs: () => number;
  readonly sufferOnNextRun: (mishap: Mishap) => void;
  readonly stalled: Promise<void>;
  readonly rejectEveryDocument: () => void;
}

function linesOf(source: string, rejecting: boolean): Effect.Effect<readonly string[], InvalidInput> {
  const lines = source.split('\n');
  const issues = lines.flatMap((line, index) =>
    rejecting || line.includes('oops') ? [{ detail: `Line ${index + 1} is not accepted`, pointer: '' }] : [],
  );
  return issues.length === 0
    ? Effect.succeed(lines)
    : Effect.fail(new InvalidInput({ detail: 'The probe document has lines it does not accept', issues }));
}

const mishaps: Readonly<Record<Mishap, Effect.Effect<never, Unavailable | Conflict>>> = {
  stall: Effect.never,
  unavailable: Effect.fail(new Unavailable({ detail: 'The probe cannot answer now' })),
  unoffered: Effect.fail(
    new Unavailable({
      detail: 'The probe cannot reach that model, only others',
      kind: 'model_not_offered',
      because: 'provider_not_configured',
    }),
  ),
  conflict: Effect.fail(new Conflict({ detail: 'The probe cannot run this definition as written; update it' })),
  unworkable: Effect.fail(
    new Conflict({ detail: 'The program of the probe raised an error on line 2: stop', kind: 'unworkable' }),
  ),
  unknown: Effect.fail(
    new Conflict({
      detail: 'The probe could not finish after calling a tool that may post',
      kind: 'effect_unknown',
      because: 'tool_error',
    }),
  ),
  breakdown: Effect.die(new Error('The probe broke down')),
  spent: Effect.fail(
    new Unavailable({
      detail: 'The probe was answered, but not usably',
      record: { usage: spentUsage, duration_ms: 25 },
    }),
  ),
  overspent: Effect.fail(
    new Unavailable({ detail: 'The probe was answered at length', record: { answer: 'x'.repeat(1_048_577) } }),
  ),
};

const seatsSchema = Result.getOrThrow(
  compileJsonSchema(
    { type: 'object', properties: { seats: { type: 'integer', minimum: 1 } } },
    { what: 'input', nesting: mostValueDepth },
  ),
);

function answerTo(input: Schema.Json, run: RunContext, runs: number): Effect.Effect<CapabilityAnswer, InvalidInput> {
  if (Predicate.hasProperty(input, 'seats')) {
    return checkedInput(input, seatsSchema, 'probe').pipe(Effect.as({ output: input, record: {} }));
  }
  if (Predicate.hasProperty(input, 'reject')) {
    return Effect.fail(
      new InvalidInput({
        detail: 'The probe rejects the input',
        issues: [{ detail: 'Expected anything but reject', pointer: '/reject' }],
      }),
    );
  }
  if (Predicate.hasProperty(input, 'unmeasurable')) {
    return Effect.succeed({ output: Number.NaN, record: {} });
  }
  if (Predicate.hasProperty(input, 'bulk') && Predicate.isNumber(input.bulk)) {
    return Effect.succeed({ output: 'x'.repeat(input.bulk), record: {} });
  }
  const { id, org, playbook, caller, definition } = run;
  return Effect.succeed({
    output: { input, run: { id, org, playbook, caller: { ...caller }, definition: { ...definition } } },
    record: { runs },
  });
}

export function overviewOfAProbe(name: string): string {
  return [
    `# ${name}`,
    'This probe has no description yet.',
    '## What it needs',
    'It takes any input, which its document does not describe.',
    '## What it produces',
    'It produces any output, which its document does not describe.\n',
  ].join('\n\n');
}

export function probe(): Probe {
  let runs = 0;
  let nextMishap: Mishap | undefined;
  let rejecting = false;
  const stalling = Promise.withResolvers<void>();
  const capability = defineCapability({
    type: 'probe',
    title: 'Probe',
    guide: { name: 'probe' },
    noun: { one: 'probe', other: 'probes' },
    describeOutput: () => 'It answered.',
    mediaType: 'text/plain',
    parse: (source: string) => linesOf(source, rejecting),
    summarize: () => ({}),
    run: (_lines, input, run) =>
      Effect.suspend((): Effect.Effect<CapabilityAnswer, CapabilityRejection> => {
        runs += 1;
        const mishap = nextMishap;
        nextMishap = undefined;
        if (mishap === 'stall') {
          stalling.resolve();
        }
        return mishap === undefined ? answerTo(input, run, runs) : mishaps[mishap];
      }),
  });
  return {
    capability,
    runs: () => runs,
    sufferOnNextRun: (mishap) => {
      nextMishap = mishap;
    },
    rejectEveryDocument: () => {
      rejecting = true;
    },
    stalled: stalling.promise,
  };
}
