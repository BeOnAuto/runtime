import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { loadedRunOf, RunLogEventSchema, snapshotFromChunks, type RunOutput } from '../../index.ts';

const CorpusOfFormatSixSchema = Schema.Struct({
  stream: Schema.Array(Schema.Struct({ version: Schema.Int, event: Schema.JsonObject })),
  snapshot: Schema.Struct({ chunks: Schema.Array(Schema.String) }),
});

const { stream, snapshot } = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusOfFormatSixSchema))(
  readFileSync(fileURLToPath(new URL('../../../corpus/format-6.json', import.meta.url)), 'utf8'),
);

const snapshotText = snapshot.chunks.join('');

const decodeEvent = Schema.decodeUnknownResult(Schema.toCodecJson(RunLogEventSchema));

const readJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json));

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const heldArguments = { primitive: 'inference', name: 'summarize', input: { text: 'hello' } };

const callOfFormatSix = {
  type: 'input_applied',
  format: 6,
  receipt: { kind: 'started', key: '0199a3c4-7d2e-7c1a-9b3f-000000000302', at: 1790845200000 },
  steps: [
    {
      reference: '/do/0/summarize',
      run: 1,
      outcome: 'waiting',
      name: 'summarize',
      times: 1,
      caused_by: 'input',
      waits_for: 'call',
    },
  ],
  resumed: null,
  patch: [
    { op: 'replace', path: '/executionId', value: '0199a3c4-7d2e-7c1a-9b3f-000000000302' },
    { op: 'replace', path: '/status', value: 'running' },
    {
      op: 'replace',
      path: '/workflow',
      value: {
        document: {
          document: { dsl: '1.0.3', namespace: 'acme', name: 'test', version: '1.0.0' },
          do: [
            {
              summarize: {
                call: 'execute_spec',
                with: { primitive: 'inference', name: 'summarize', input: { text: '${ .text }' } },
              },
            },
            { answer: { set: { summary: '${ .summary }', runtime: '${ $runtime.name }' } } },
          ],
        },
        input: 1,
      },
    },
    { op: 'replace', path: '/limits/mostDurationMs', value: 2592000000 },
    { op: 'replace', path: '/limits/longestCallMs', value: 600000 },
    { op: 'replace', path: '/startedAt', value: 1790845200000 },
    { op: 'replace', path: '/lastInputAt', value: 1790845200000 },
    { op: 'replace', path: '/inputs', value: 1 },
    { op: 'replace', path: '/random/seed', value: 7 },
    { op: 'add', path: '/runs/~1do~10~1summarize', value: 1 },
    { op: 'replace', path: '/timers/next', value: 3 },
    {
      op: 'add',
      path: '/timers/armed/1',
      value: { purpose: 'deadline', reference: '/', armedAt: 1790845200000, dueAt: 1793437200000 },
    },
    {
      op: 'add',
      path: '/timers/armed/2',
      value: { purpose: 'call_deadline', reference: '/do/0/summarize', armedAt: 1790845200000, dueAt: 1790845800000 },
    },
    {
      op: 'add',
      path: '/calls/["0199a3c4-7d2e-7c1a-9b3f-000000000302","~1do~10~1summarize",1]',
      value: { executionId: '0199a3c4-7d2e-7c1a-9b3f-000000000302', reference: '/do/0/summarize', run: 1 },
    },
    { op: 'replace', path: '/heldBytes', value: 8563 },
    { op: 'add', path: '/machine/values/1', value: { value: { text: 'hello' }, bytes: 16 } },
    {
      op: 'add',
      path: '/machine/values/2',
      value: { value: { primitive: 'inference', name: 'summarize', input: { text: 'hello' } }, bytes: 69 },
    },
    { op: 'replace', path: '/machine/nextValue', value: 3 },
    {
      op: 'replace',
      path: '/machine/root',
      value: {
        reference: '/',
        run: 1,
        startedAt: 1790845200000,
        context: 0,
        rawInput: 1,
        input: 1,
        variables: {},
        timeout: null,
        body: {
          kind: 'list',
          list: {
            pointer: '/do',
            position: 0,
            data: 1,
            variables: {},
            current: {
              kind: 'running',
              task: {
                reference: '/do/0/summarize',
                run: 1,
                startedAt: 1790845200000,
                context: 0,
                rawInput: 1,
                input: 1,
                variables: {},
                timeout: null,
                body: {
                  kind: 'call',
                  key: { executionId: '0199a3c4-7d2e-7c1a-9b3f-000000000302', reference: '/do/0/summarize', run: 1 },
                  function: 'execute_spec',
                  arguments: 2,
                  label: 'the reasoning function summarize',
                  deadline: '2',
                },
              },
            },
          },
        },
      },
    },
    { op: 'replace', path: '/historyBytes', value: 3332 },
  ],
  outputs: [
    {
      kind: 'arm_timer',
      executionId: '0199a3c4-7d2e-7c1a-9b3f-000000000302',
      timerId: '1',
      dueAt: 1793437200000,
      purpose: 'deadline',
      label: 'the most the workflow may run',
    },
    {
      kind: 'start_call',
      key: { executionId: '0199a3c4-7d2e-7c1a-9b3f-000000000302', reference: '/do/0/summarize', run: 1 },
      function: 'execute_spec',
      arguments: { primitive: 'inference', name: 'summarize', input: { text: 'hello' } },
      longestMs: 600000,
    },
    {
      kind: 'arm_timer',
      executionId: '0199a3c4-7d2e-7c1a-9b3f-000000000302',
      timerId: '2',
      dueAt: 1790845800000,
      purpose: 'call_deadline',
      label: '/do/0/summarize deadline',
    },
  ],
};

const writeEvent = Schema.encodeSync(Schema.toCodecJson(RunLogEventSchema));

const rejected = { status: 'rejected', detail: 'The tool server is gone' };

type Written = Readonly<Record<string, unknown>>;

const settlementsOfFormatSix: readonly Written[] = [
  { ...rejected, reason: 'unavailable', kind: 'mcp_server_failed', because: 'mcp_server_not_configured' },
  { ...rejected, reason: 'unavailable', kind: 'tools_unfinished', because: 'failing' },
  { ...rejected, reason: 'unavailable' },
  { ...rejected, reason: 'conflict', kind: 'stalled' },
];

const settlementsNow = [
  { ...rejected, reason: 'unavailable', kind: 'tool_server_failed', because: 'tool_server_not_configured' },
  ...settlementsOfFormatSix.slice(1),
];

function settledWith(settlement: object): unknown {
  return { ...stream[0]?.event, outputs: [{ kind: 'settle', executionId: runId, settlement }] };
}

function settlementOf(output: RunOutput | undefined): unknown {
  return output?.kind === 'settle' ? output.settlement : output;
}

function decoded(event: unknown) {
  return Result.getOrThrow(decodeEvent(event));
}

function settlementsRead(settlements: readonly Written[]): readonly unknown[] {
  return settlements.map((settlement) => settlementOf(decoded(settledWith(settlement)).outputs[0]));
}

function settlementsWrittenBack(settlements: readonly Written[]): readonly unknown[] {
  return settlements.map((settlement) => writeEvent(decoded(settledWith(settlement))));
}

function runIdOf(output: RunOutput): string {
  return 'key' in output ? output.key.runId : output.runId;
}

describe('an event of formats 1 to 6', () => {
  it('is read with its outputs and call keys naming the run executionId, and gives them naming it runId', () => {
    const outputs = stream.flatMap(({ event }) => decoded(event).outputs);

    expect(outputs.map((output) => runIdOf(output))).toEqual(Array.from({ length: 14 }, () => runId));
  });

  it('is refused when an output names the run as format 7 does, or when it holds a member format 6 does not describe', () => {
    const settling = JSON.stringify(stream.at(-1)?.event).replaceAll('"executionId":', '"runId":');

    expect([
      Result.isFailure(decodeEvent(readJson(settling))),
      Result.isFailure(decodeEvent({ ...stream[0]?.event, noted: true })),
    ]).toEqual([true, true]);
  });
});

describe('the words of an event of formats 1 to 6', () => {
  it('give the rejection a call answered and the settlement of a run the words of format 8, written back as they were', () => {
    const answered = stream[1]?.event;

    expect(decoded(answered).receipt).toMatchObject({ rejection: { kind: 'tool_server_failed' } });
    expect(writeEvent(decoded(answered))).toEqual(answered);
    expect(settlementsRead(settlementsOfFormatSix)).toEqual(settlementsNow);
    expect(settlementsWrittenBack(settlementsOfFormatSix)).toEqual(
      settlementsOfFormatSix.map((each) => settledWith(each)),
    );
  });

  it('refuse a settlement that holds not_testable, which format 8 has no word for', () => {
    const raisedByItsDocument = {
      ...rejected,
      reason: 'unavailable',
      kind: 'tools_unfinished',
      because: 'not_testable',
    };

    expect(Result.isFailure(decodeEvent(settledWith(raisedByItsDocument)))).toBe(true);
  });
});

describe('a snapshot of formats 1 to 6', () => {
  it('is read with the run named executionId, and gives it naming the run runId', () => {
    expect(Result.getOrThrow(snapshotFromChunks(snapshot.chunks))).toMatchObject({ format: 6, runId, version: 2 });
  });

  it('is refused when it names the run as format 7 does, or holds a member format 6 does not describe', () => {
    expect([
      Result.isFailure(snapshotFromChunks([snapshotText.replace('"executionId":', '"runId":')])),
      Result.isFailure(snapshotFromChunks([snapshotText.replace('"version":', '"noted":true,"version":')])),
    ]).toEqual([true, true]);
  });
});

describe('a log of format 6 of a call', () => {
  it('loads unchanged when its arguments say execute_spec and primitive, which are data the document holds', () => {
    const event = decoded(callOfFormatSix);
    const { state } = loadedRunOf({ snapshot: null, tail: [{ version: 1, event }] });

    expect(event.outputs).toContainEqual({
      kind: 'start_call',
      key: { runId: callOfFormatSix.receipt.key, reference: '/do/0/summarize', run: 1 },
      function: 'execute_spec',
      arguments: heldArguments,
      longestMs: 600_000,
    });
    expect(state.workflow?.document).toMatchObject({
      do: [{ summarize: { call: 'execute_spec', with: { primitive: 'inference', name: 'summarize' } } }, {}],
    });
    expect(state.machine.values[2]?.value).toEqual(heldArguments);
  });
});
