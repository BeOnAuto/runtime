import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { stateFormats, stateInCurrentFormat } from '../../index.ts';

const CorpusOfFormatSixSchema = Schema.Struct({ snapshot: Schema.Struct({ chunks: Schema.Array(Schema.String) }) });

const SnapshotOfFormatSixSchema = Schema.Struct({ executionId: Schema.String, state: Schema.JsonObject });

const readSnapshot = Schema.decodeUnknownSync(Schema.fromJsonString(SnapshotOfFormatSixSchema));

const { snapshot } = Schema.decodeUnknownSync(Schema.fromJsonString(CorpusOfFormatSixSchema))(
  readFileSync(fileURLToPath(new URL('../../../corpus/format-6.json', import.meta.url)), 'utf8'),
);

const snapshotText = snapshot.chunks.join('');

const { executionId: runId, state: stateOfFormatSix } = readSnapshot(snapshotText);

const [, , , , , formatSix] = stateFormats.older;

const asking = '/do/0/all/fork/branches/3/asking/try/0/ask';

const heldValue = { value: { executionId: 'a value the run holds' }, bytes: 41 };

describe('a state of format 6', () => {
  it('is read strictly as format 6 and upcast to name its run runId, in its calls, its listeners and the key of every call it waits on', () => {
    const upcast = stateInCurrentFormat(6, stateOfFormatSix);

    expect(formatSix?.format).toBe(6);
    expect([upcast.runId, Object.values(upcast.calls), Object.values(upcast.listeners)]).toEqual([
      runId,
      [{ runId, reference: asking, run: 1 }],
      [{ runId, reference: '/do/0/all/fork/branches/1/both', run: 1 }],
    ]);
    expect(upcast.machine.root).toMatchObject({
      body: {
        list: {
          current: {
            task: {
              body: {
                branches: [
                  {},
                  {},
                  {},
                  {
                    task: {
                      body: { phase: { list: { current: { task: { body: { key: { runId, reference: asking } } } } } } },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    });
  });

  it('keeps the names of the values it holds, which are data', () => {
    const { state } = readSnapshot(snapshotText.replace('"values":{', `"values":{"9":${JSON.stringify(heldValue)},`));

    expect(stateInCurrentFormat(6, state).machine.values[9]).toEqual(heldValue);
  });

  it('is refused when it names its run as format 7 does', () => {
    const { executionId: _executionId, ...withoutExecutionId } = stateOfFormatSix;

    expect(() => stateInCurrentFormat(6, { ...withoutExecutionId, runId })).toThrow(/excess property/u);
  });
});
