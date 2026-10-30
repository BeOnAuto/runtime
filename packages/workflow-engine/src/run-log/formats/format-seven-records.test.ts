import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { RunLogEventSchema, snapshotFromChunks, stateInCurrentFormat, type RunOutput } from '../../index.ts';

const CorpusOfFormatSevenSchema = Schema.Struct({
  stream: Schema.Array(Schema.Struct({ version: Schema.Int, event: Schema.JsonObject })),
  snapshot: Schema.Struct({ chunks: Schema.Array(Schema.String) }),
});

const { stream, snapshot } = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusOfFormatSevenSchema))(
  readFileSync(fileURLToPath(new URL('../../../corpus/format-7.json', import.meta.url)), 'utf8'),
);

const snapshotText = snapshot.chunks.join('');

const readSnapshotState = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ state: Schema.JsonObject })));

const EventJsonSchema = Schema.toCodecJson(RunLogEventSchema);

const decodeEvent = Schema.decodeUnknownResult(EventJsonSchema);

const writeEvent = Schema.encodeSync(EventJsonSchema);

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

type Written = Readonly<Record<string, unknown>>;

const [started, answered] = stream;

const rejected = { status: 'rejected', detail: 'The tool server is gone' };

const unavailableNow = { ...rejected, reason: 'unavailable', kind: 'tool_server_failed', because: 'unreachable' };

const settlementsOfFormatSeven: readonly Written[] = [
  { ...rejected, reason: 'unavailable', kind: 'mcp_server_failed', because: 'unreachable' },
  { ...rejected, reason: 'unavailable', kind: 'tool_not_offered', because: 'mcp_server_not_configured' },
  { ...rejected, reason: 'unavailable', because: 'failing' },
  { ...rejected, reason: 'conflict', kind: 'unworkable', because: 'mcp_server_not_configured' },
  { ...rejected, reason: 'conflict', kind: 'stalled' },
  { ...rejected, reason: 'invalid_input' },
  { status: 'succeeded', output: { kind: 'mcp_server_failed' } },
];

const settlementsNow: readonly Written[] = [
  unavailableNow,
  { ...rejected, reason: 'unavailable', kind: 'tool_not_offered', because: 'tool_server_not_configured' },
  { ...rejected, reason: 'unavailable', because: 'failing' },
  { ...rejected, reason: 'conflict', kind: 'unworkable', because: 'tool_server_not_configured' },
  { ...rejected, reason: 'conflict', kind: 'stalled' },
  { ...rejected, reason: 'invalid_input' },
  { status: 'succeeded', output: { kind: 'mcp_server_failed' } },
];

function settledWith(settlement: object): unknown {
  return { ...started?.event, outputs: [{ kind: 'settle', runId, settlement }] };
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

function settlementOf(output: RunOutput | undefined): unknown {
  return output?.kind === 'settle' ? output.settlement : output;
}

describe('an event of format 7', () => {
  it('gives the rejection a call answered the words of format 8, and writes it back with the words of format 7', () => {
    const event = decoded(answered?.event);

    expect(event.receipt).toMatchObject({ rejection: { kind: 'tool_server_failed', because: 'unreachable' } });
    expect(writeEvent(event)).toEqual(answered?.event);
  });

  it('gives the settlement of a run the words of format 8, and writes it back with the words of format 7', () => {
    expect(settlementsRead(settlementsOfFormatSeven)).toEqual(settlementsNow);
    expect(settlementsWrittenBack(settlementsOfFormatSeven)).toEqual(
      settlementsOfFormatSeven.map((each) => settledWith(each)),
    );
  });

  it('keeps not_testable as written in a receipt and a raised error, which hold a string, and refuses a settlement that holds it', () => {
    const rejection = { kind: 'effect_unknown', because: 'not_testable' };
    const receipt = { ...decoded(answered?.event).receipt, rejection };
    const receivedWithIt = { ...answered?.event, receipt };
    const raisedError = {
      type: 'https://on.auto/problems/effect_unknown',
      status: 409,
      instance: '/do/0',
      ...rejection,
    };
    const raised = { kind: 'raised', error: raisedError };
    const { state } = readSnapshotState(snapshotText);

    expect(decoded(receivedWithIt).receipt).toEqual(receipt);
    expect(writeEvent(decoded(receivedWithIt))).toEqual(receivedWithIt);
    expect(stateInCurrentFormat(7, { ...state, outcome: raised }).outcome).toEqual(raised);
    expect(Result.isFailure(decodeEvent(settledWith({ ...rejected, reason: 'conflict', ...rejection })))).toBe(true);
  });

  it('is refused when it names a kind as format 8 does, or holds a member format 7 does not describe', () => {
    expect([
      Result.isFailure(decodeEvent(settledWith(unavailableNow))),
      Result.isFailure(decodeEvent({ ...started?.event, noted: true })),
    ]).toEqual([true, true]);
  });
});

describe('a snapshot of format 7', () => {
  it('is read as it was written, its state read by the reader of format 7', () => {
    expect(Result.getOrThrow(snapshotFromChunks(snapshot.chunks))).toMatchObject({ format: 7, runId, version: 2 });
  });

  it('is refused when it holds a member format 7 does not describe', () => {
    expect(Result.isFailure(snapshotFromChunks([snapshotText.replace('"version":', '"noted":true,"version":')]))).toBe(
      true,
    );
  });
});
