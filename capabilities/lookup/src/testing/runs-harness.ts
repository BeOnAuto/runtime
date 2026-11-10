import {
  defineCapability,
  defineCreateDefinition,
  defineRunDefinition,
  outputInWords,
  type SucceededRunsReader,
} from '@on.auto/definitions';
import { admittingMeter, uncheckedPages } from '@on.auto/definitions/testing';
import {
  allPermissions,
  Conflict,
  makeDispatcher,
  type CallerIdentity,
  type Outcome,
  type Runnable,
} from '@on.auto/operations';
import { memoryLedger, memoryPlaybookRegistry, recordingReporter } from '@on.auto/operations/testing';
import { reportingAccess } from '@on.auto/tool-servers/testing';
import { DateTime, Effect, Layer, type Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { onTestFinished } from 'vitest';

import { makeLookupFunctionAdapter } from '../capability/lookup-function.ts';

const ofTheHarness = { org: 'acme', playbook: 'alpha' };

const caller: CallerIdentity = {
  id: 'acme-admin',
  name: 'acme-admin',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const refusingInput = 'refuse';

const refused = new Conflict({ detail: 'The run was asked to refuse', kind: 'unworkable' });

const answeringItsInput = defineCapability({
  type: 'computation',
  title: 'Computation',
  guide: { name: 'computation-function' },
  noun: { one: 'computation function', other: 'computation functions' },
  describeOutput: outputInWords('result'),
  mediaType: 'text/markdown',
  parse: (source: string) => Effect.succeed(source),
  summarize: () => ({}),
  run: (_, input: Schema.Json) =>
    input === refusingInput ? Effect.fail(refused) : Effect.succeed({ output: input, record: {} }),
});

export interface RunsHarnessOptions {
  readonly mostPagesRead?: number;
  readonly readingBegins?: (harness: RunsHarness) => Promise<unknown>;
}

export interface AskedRun {
  readonly type: string;
  readonly name: string;
  readonly input: Schema.Json;
  readonly at: string;
  readonly runId?: string;
}

export interface RunsHarness {
  readonly saved: (type: string, name: string, source: string) => Promise<Outcome>;
  readonly ran: (asked: AskedRun) => Promise<Outcome>;
}

export function runsHarness({ readingBegins, ...bounds }: RunsHarnessOptions = {}): RunsHarness {
  const ledger = memoryLedger();
  const { access } = reportingAccess({});
  onTestFinished(access.close);
  let begins: (() => Promise<unknown>) | undefined;
  const begun = () => {
    const beginning = begins;
    begins = undefined;
    return beginning === undefined ? Promise.resolve() : beginning();
  };
  const runs: SucceededRunsReader = {
    readRecorded: (place, selection, page) =>
      Effect.andThen(Effect.promise(begun), ledger.service.readRecorded(place, selection, page)),
    content: ledger.service.content,
  };
  const capabilities = [answeringItsInput, makeLookupFunctionAdapter({ tools: access, runs, ...bounds })];
  const creating = defineCreateDefinition(capabilities, uncheckedPages);
  const running = defineRunDefinition(capabilities);
  const dispatcher = makeDispatcher([]);
  const called = (registration: Runnable<'playbook'>, input: Schema.Json, at: string) =>
    Effect.runPromise(
      TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at))).pipe(
        Effect.andThen(
          dispatcher.dispatchToPlaybook(registration, { caller, ...ofTheHarness, input, encoding: 'json' }),
        ),
        Effect.provide(
          Layer.mergeAll(
            ledger.layer,
            memoryPlaybookRegistry([ofTheHarness]),
            recordingReporter().layer,
            admittingMeter,
            TestClock.layer(),
          ),
        ),
      ),
    );
  const harness: RunsHarness = {
    saved: (type, name, source) =>
      called(creating.registration, { type, name, source, diagram: 'none' }, '2026-10-01T08:00:00.000Z'),
    ran: ({ type, name, input, at, runId }) =>
      called(running.registration, { type, name, input, ...(runId === undefined ? {} : { run_id: runId }) }, at),
  };
  begins = readingBegins === undefined ? undefined : () => readingBegins(harness);
  return harness;
}
