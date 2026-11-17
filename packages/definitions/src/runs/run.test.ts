import { readFileSync } from 'node:fs';

import { ConflictKindSchema, factOf, RunCancelled, RunContextSchema } from '@on.auto/operations';
import { payloadFields, withPayloads } from '@on.auto/operations/payloads';
import { Result, Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  cancelRequestOf,
  type FunctionRun,
  isFunctionRun,
  isWorkflowRun,
  lastEndingOf,
  type Run,
  runEndingOf,
  type Settlement,
  type WorkflowRun,
} from '../index.ts';
import { modelCallAnswered, modelCallSent } from '../journal-testing/model-calls.ts';
import { recordedAdmin } from '../testing/callers.ts';
import { settledAt, withHandOn } from '../testing/relaying.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';
import type { CallFact, ModelCallFact, RunCommand } from './run-commands.ts';
import { runDecider } from './run-decider.ts';
import { AnsweredRecordSchema, type RecordedRunEvent, RunEventSchema } from './run-events.ts';
import { runStartedOf } from './run-starts.ts';

const functionRun: Run = {
  run_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  type: 'reasoning',
  name: 'review-campaign',
  definition_version: 3,
  status: 'succeeded',
  output: 'The brief meets the criteria.',
  started_at: '2026-09-02T00:00:00.000Z',
  started_by: { id: 'author', name: 'author' },
  finished_at: '2026-09-02T00:01:00.000Z',
};

const computationRun: Run = { ...functionRun, type: 'computation', output: { total_spend_cents: 17_628 } };

const interactionRun: Run = { ...functionRun, type: 'interaction', output: { choice: 'approve' } };

const predictionRun: Run = {
  ...functionRun,
  type: 'prediction',
  output: {
    period: 'month',
    lines: [{ name: 'orders', points: [{ at: '2026-10', value: 140, low: 120, high: 160 }] }],
  },
};

const workflowRun: Run = { ...functionRun, type: 'workflow' };

const ofGreet = { definitionType: 'echo', definitionName: 'greet', definitionVersion: 1 };

const atTheStart = recordedWith({ runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z', ...ofGreet });

const during = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:02.000Z' };

const meanwhile = recordedWith({ ...during, ...ofGreet });

function decided(fact: CallFact, ...history: readonly RecordedRunEvent[]) {
  const command: RunCommand = { type: 'call', fact, fencingToken: 1, ...during };
  return runDecider.decide(command, runStateAfter(history));
}

const input = { who: 'Ada' };

const startedToResume = atTheStart({ type: 'run_started', data: { started_by: recordedAdmin, input, resumes: true } });

const startedInItsCall = atTheStart({ type: 'run_started', data: { started_by: recordedAdmin, input } });

const cancelAsked = meanwhile({ type: 'run_cancel_requested', data: { kind: 'requested', reason: 'Not needed' } });

const cancelledAsAsked = new RunCancelled({ detail: 'Not needed', kind: 'requested' });

const modelCallStarted = (number: number): ModelCallFact => ({
  type: 'model_call_started',
  data: { number, ...modelCallSent() },
});

const modelCallEnded: ModelCallFact = { type: 'model_call_answered', data: { number: 1, ...modelCallAnswered() } };

const toolCallStarted: CallFact = {
  type: 'tool_call_started',
  data: { call_id: 'toolu_01', server: 'graph', tool: 'search', arguments_bytes: 17 },
};

const becausesBeforeTheLimits = Schema.Literals([
  'provider_not_configured',
  'model_not_allowed',
  'tool_server_not_configured',
  'tool_not_allowed',
  'tool_not_listed',
  'connection_pending',
  'connection_broken',
  'connection_not_allowed',
  'connection_unavailable',
  'failing',
  'rate_limited',
  'unreachable',
  'key_refused',
  'scope_lacking',
  'server_failed',
  'tool_error',
  'model_unavailable',
  'definition_refused',
  'run_bound',
  'no_answer',
  'restarted_without_content',
  'input_missing',
  'answer_missing',
  'workflow_document_missing',
  'function_document_missing',
  'call_outcome_unknown',
  'only_read',
  'stalled',
  'none_left',
  'free_daily_limit',
  'free_month_used',
  'key_rotated',
  'installation_revoked',
  'org_deleted',
  'org_purged',
]);

const SucceededBeforeTheLimits = factOf(
  'run_succeeded',
  withPayloads(Schema.Struct({ ...payloadFields('output', Schema.Json), record: Schema.JsonObject }), ['output']),
  RunContextSchema,
);

const ConflictBeforeTheLimits = factOf(
  'run_rejected',
  Schema.Struct({
    rejection: Schema.Struct({
      reason: Schema.Literal('conflict'),
      detail: Schema.String,
      kind: Schema.optionalKey(ConflictKindSchema),
      because: Schema.optionalKey(becausesBeforeTheLimits),
    }),
    record: Schema.optionalKey(Schema.JsonObject),
  }),
  RunContextSchema,
);

function textIn(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function recordedIn(path: string): unknown {
  return JSON.parse(textIn(path));
}

const succeededBefore = Schema.decodeUnknownResult(Schema.toCodecJson(SucceededBeforeTheLimits));

const rejectedBefore = Schema.decodeUnknownResult(Schema.toCodecJson(ConflictBeforeTheLimits));

const onTheRun = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'key_7f3a',
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'reasoning',
  definitionName: 'qualify-lead',
  definitionVersion: 2,
};

const calledBy = { runId: '0199a3c4-7d2e-7c1a-9b3f-000000000001', reference: '/do/0/check', run: 1 };

const context = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'playbook:alpha',
  runId: '0199a3c4-7d2e-7c1a-9b3f-000000000002',
  definitionType: 'workflow',
  definitionName: 'check',
  definitionVersion: 1,
  calledBy,
};

const started = { type: 'run_started', data: { started_by: recordedAdmin, input: {} }, context };

const succeeded = { type: 'run_succeeded', data: { output: 'done', record: {} }, context };

const cancelAskedRunEndings = { type: 'run_cancel_requested', data: { kind: 'deadline', reason: 'Out' }, context };

const isARunFact = Schema.is(RunEventSchema);

const isARecordAnswered = Schema.is(AnsweredRecordSchema);

const promptKept = { prompt_sha256: 'a'.repeat(64), prompt_bytes: 17_038 };

function succeededWith(record: Schema.JsonObject) {
  return { type: 'run_succeeded', data: { output: { score: 0.8 }, record }, context: onTheRun };
}

const contextRunStarts = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'playbook:alpha',
  runId: 'run-1',
  definitionType: 'workflow',
  definitionName: 'close',
  definitionVersion: 3,
};

describe('a run', () => {
  it('is a function run when it ran a reasoning, an interaction, a prediction or a computation function, and a workflow run when it ran a workflow', () => {
    const runs = [functionRun, interactionRun, predictionRun, computationRun, workflowRun];

    const functionRuns = runs.filter((run) => isFunctionRun(run));
    const workflowRuns = runs.filter((run) => isWorkflowRun(run));

    expectTypeOf(functionRuns).toEqualTypeOf<FunctionRun[]>();
    expectTypeOf(workflowRuns).toEqualTypeOf<WorkflowRun[]>();
    expect([functionRuns, workflowRuns]).toEqual([
      [functionRun, interactionRun, predictionRun, computationRun],
      [workflowRun],
    ]);
  });

  it.each(['echo', 'reason', 'interact', 'predict', 'compute'])(
    'is neither of a custom adapter or a name that is not a function type: %s',
    (type) => {
      const run = { ...functionRun, type };

      expect([isFunctionRun(run), isWorkflowRun(run)]).toEqual([false, false]);
    },
  );
});

describe('a call of a run that resumes, once its cancel was recorded', () => {
  it('starts nothing more, refused as cancelled, while an end of a call it started is still taken', () => {
    const modelCallMade = meanwhile(modelCallStarted(1));

    expect([
      decided(modelCallStarted(2), startedToResume, modelCallMade, meanwhile(modelCallEnded), cancelAsked),
      decided(toolCallStarted, startedToResume, cancelAsked),
      decided(modelCallEnded, startedToResume, modelCallMade, cancelAsked),
      decided(toolCallStarted, startedInItsCall, cancelAsked),
    ]).toEqual([
      Result.fail(cancelledAsAsked),
      Result.fail(cancelledAsAsked),
      Result.succeed([modelCallEnded]),
      Result.succeed([{ type: 'tool_call_started', data: { ...toolCallStarted.data, number: 1 } }]),
    ]);
  });
});

describe('a run that answered at a limit, as a release before the readers of limits reads it', () => {
  it('reads the success recorded in 0.61.0 through that release’s schema, passing over the limit it does not know', () => {
    expect(Result.getOrThrow(succeededBefore(recordedIn('0.61.0/run_succeeded.json')))).toEqual({
      type: 'run_succeeded',
      data: { output: { score: 0.6 }, record: {} },
      context: onTheRun,
    });
  });
});

describe('a run stopped at a limit, as a release before the readers of limits reads it', () => {
  it('is not read, since its because is one that release does not know, so the readers ship before anything writes it', () => {
    const recorded = textIn('0.61.0/run_rejected.json');
    const ofABecauseItKnows: unknown = JSON.parse(
      recorded.replace('"because": "max_tool_calls"', '"because": "run_bound"'),
    );

    expect([
      Result.isFailure(rejectedBefore(recordedIn('0.61.0/run_rejected.json'))),
      Result.isSuccess(rejectedBefore(ofABecauseItKnows)),
    ]).toEqual([true, true]);
  });
});

describe('the ending of a run, read from its record', () => {
  it('is a success, a rejection or a failure with the call it answers in its context, and nothing for any other record', () => {
    expect([runEndingOf(succeeded), runEndingOf(started), runEndingOf({ type: 'nonsense' })]).toEqual([
      succeeded,
      undefined,
      undefined,
    ]);
  });

  it('is the last record of a run that ended, and nothing for a run still going', () => {
    expect([lastEndingOf([started, succeeded]), lastEndingOf([started, succeeded, started]), lastEndingOf([])]).toEqual(
      [succeeded, undefined, undefined],
    );
  });
});

describe('a cancel request, read from its record', () => {
  it('is the request with its kind and reason, who asked, when and of which run, and nothing for any other record', () => {
    const { at, by, runId } = context;

    expect([cancelRequestOf(cancelAskedRunEndings), cancelRequestOf(succeeded)]).toEqual([
      { ...cancelAskedRunEndings, context: { at, by, runId } },
      undefined,
    ]);
  });
});

describe('the record of a run that succeeded', () => {
  it('holds a prompt of any JSON value, keeps one outside by its digest and size, or holds none', () => {
    const records: readonly Schema.JsonObject[] = [
      { prompt: { message: 'Hi', truncated: false } },
      { prompt: 'Hi' },
      promptKept,
      { steps: 3 },
      {},
    ];

    expect(records.map((record) => isARunFact(succeededWith(record)))).toEqual([true, true, true, true, true]);
  });

  it('is refused with a digest and no size, a size and no digest, both arms of its prompt, or a digest or a size that is none', () => {
    const records: readonly Schema.JsonObject[] = [
      { prompt_sha256: promptKept.prompt_sha256 },
      { prompt_bytes: promptKept.prompt_bytes },
      { prompt: 'Hi', ...promptKept },
      { ...promptKept, prompt_sha256: 'A'.repeat(64) },
      { ...promptKept, prompt_bytes: -1 },
      { ...promptKept, prompt_bytes: 1.5 },
    ];

    expect(records.map((record) => isARunFact(succeededWith(record)))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('the record a capability answers with', () => {
  it('holds its prompt, where it has one, and names none by a digest, since only the runtime keeps a prompt outside a run', () => {
    const records: readonly Schema.JsonObject[] = [{ prompt: 'Hi' }, { steps: 3 }, promptKept, { prompt_bytes: 5 }];

    expect(records.map((record) => isARecordAnswered(record))).toEqual([true, true, false, false]);
  });
});

describe('the start of a run read from its record', () => {
  it('is the context of the start, and nothing for any other record', () => {
    expect([
      runStartedOf({
        type: 'run_started',
        data: { started_by: recordedAdmin, input: {} },
        context: { ...contextRunStarts, depth: 2 },
      }),
      runStartedOf({ type: 'run_failed', data: {}, context: contextRunStarts }),
      runStartedOf(null),
      runStartedOf('not a record'),
    ]).toEqual([{ ...contextRunStarts, depth: 2 }, undefined, undefined, undefined]);
  });

  it('is refused, as any unreadable fact of the run, when the start is in a shape the run does not read', () => {
    const { definitionName: _name, ...withoutItsDefinition } = contextRunStarts;

    expect(() =>
      runStartedOf({
        type: 'run_started',
        data: { started_by: recordedAdmin, input: {} },
        context: withoutItsDefinition,
      }),
    ).toThrow('Missing key');
    expect(() => runStartedOf({ type: 'run_started', data: { input: {} }, context: contextRunStarts })).toThrow(
      'Missing key',
    );
  });
});

describe('a settlement whose output is too large, absent or not JSON', () => {
  it('is a breakdown of the capability that fails the run', async () => {
    const { breakingDown, running, reading } = await withHandOn();
    await running();

    expect(await breakingDown({ status: 'succeeded', output: 'x'.repeat(1_048_576), record: {} })).toEqual(
      new Error('The capability answered with 1048580 bytes to record, more than the 1048576 allowed'),
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed', finished_at: settledAt } });
  });

  it('is a breakdown that fails the run, as before, when a success holds no output at all', async () => {
    const { breakingDown, running, reading } = await withHandOn();
    await running();
    const withoutItsOutput: Settlement = { status: 'succeeded', output: 'dropped', record: {} };
    Reflect.deleteProperty(withoutItsOutput, 'output');

    expect(await breakingDown(withoutItsOutput)).toEqual(
      new Error(
        'The data holds neither output nor output_sha256 and output_bytes, which the schema of a fact that keeps the payload refuses',
      ),
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed', finished_at: settledAt } });
  });

  it('is a breakdown as well when the output is not JSON', async () => {
    const { breakingDown, running, reading } = await withHandOn();
    await running();

    expect(Schema.isSchemaError(await breakingDown({ status: 'succeeded', output: Number.NaN, record: {} }))).toBe(
      true,
    );
    expect(await reading()).toMatchObject({ output: { status: 'failed' } });
  });
});
