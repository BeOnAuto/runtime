import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { stateFormats, stateInCurrentFormat } from '../../index.ts';

const CorpusOfFormatSevenSchema = Schema.Struct({ snapshot: Schema.Struct({ chunks: Schema.Array(Schema.String) }) });

const SnapshotOfFormatSevenSchema = Schema.Struct({ state: Schema.JsonObject });

const readSnapshot = Schema.decodeUnknownSync(Schema.fromJsonString(SnapshotOfFormatSevenSchema));

const { snapshot } = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusOfFormatSevenSchema))(
  readFileSync(fileURLToPath(new URL('../../../corpus/format-7.json', import.meta.url)), 'utf8'),
);

const snapshotText = snapshot.chunks.join('');

const { state: stateOfFormatSeven } = readSnapshot(snapshotText);

const { machine } = Schema.decodeUnknownSync(Schema.Struct({ machine: Schema.JsonObject }))(stateOfFormatSeven);

const [, , , , , , formatSeven] = stateFormats.older;

const unreachable = { kind: 'tool_server_failed', because: 'unreachable' };

const writtenInFormatSeven = { kind: 'mcp_server_failed', because: 'mcp_server_not_configured' };

const raisedError = {
  type: 'https://on.auto/problems/unavailable',
  status: 503,
  instance: '/do/0/ask',
  kind: 'tool_not_offered',
  because: 'mcp_server_not_configured',
};

const heldValue = { value: writtenInFormatSeven, bytes: 69 };

type RunState = ReturnType<typeof stateInCurrentFormat>;

function firstBranchOf({ machine: { root } }: RunState) {
  const list = root?.body.kind === 'list' ? root.body.list.current : undefined;
  return list?.kind === 'running' && list.task.body.kind === 'fork' ? list.task.body.branches[0] : undefined;
}

function phaseErrorOf(state: RunState): unknown {
  const branch = firstBranchOf(state);
  const attempt = branch?.state === 'running' && branch.task.body.kind === 'try' ? branch.task.body.phase : undefined;
  return attempt?.kind === 'backing_off' ? attempt.error : undefined;
}

describe('a state of format 7', () => {
  it('is read strictly as format 7 and upcast to give the error a call raised the words of format 8', () => {
    const upcast = stateInCurrentFormat(7, stateOfFormatSeven);

    expect(formatSeven?.format).toBe(7);
    expect(snapshotText).toContain('"kind":"mcp_server_failed","because":"unreachable"');
    expect(phaseErrorOf(upcast)).toMatchObject(unreachable);
  });

  it('gives a run that ended raised the words of format 8, in its kind and its because', () => {
    const upcast = stateInCurrentFormat(7, { ...stateOfFormatSeven, outcome: { kind: 'raised', error: raisedError } });

    expect(upcast.outcome).toEqual({
      kind: 'raised',
      error: { ...raisedError, because: 'tool_server_not_configured' },
    });
  });

  it('keeps the words of the values it holds and of the output it ended with, which are data', () => {
    const holding = {
      ...stateOfFormatSeven,
      machine: { ...machine, values: { 0: heldValue } },
      outcome: { kind: 'completed', output: writtenInFormatSeven },
    };

    const upcast = stateInCurrentFormat(7, holding);

    expect([upcast.machine.values[0], upcast.outcome]).toEqual([
      heldValue,
      { kind: 'completed', output: writtenInFormatSeven },
    ]);
  });

  it('is refused when it holds a member format 7 does not describe', () => {
    expect(() => stateInCurrentFormat(7, { ...stateOfFormatSeven, noted: true })).toThrow(/excess property/u);
  });
});
