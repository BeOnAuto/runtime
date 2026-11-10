import { contentHoldersOf } from '@on.auto/operations';
import { payloadBytesOf, payloadsNamed } from '@on.auto/operations/payloads';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { eventBytesOf, RunLogEventSchema } from '../run-log/run-event.ts';
import { stateFormatKeepingPayloads } from '../run-log/state-format.ts';
import { at, openCall } from '../testing/runs.ts';
import { RunLogRecordSchema } from './run-decider.ts';

interface Named {
  readonly sha256: string;
  readonly bytes: number;
}

const holders = contentHoldersOf([RunLogRecordSchema]);

const declaration = holders.get('input_applied') ?? {};

const codec = Schema.toCodecJson(RunLogEventSchema);

const readEvent = Schema.decodeUnknownSync(codec);

const writeEvent = Schema.encodeSync(codec);

const utf8 = new TextEncoder();

const keptArguments: Named = { sha256: 'e'.repeat(64), bytes: 20_000 };

function startingWith(kept: readonly Named[]) {
  return readEvent({
    type: 'input_applied',
    format: stateFormatKeepingPayloads,
    receipt: { kind: 'timer_fired', key: '1', at },
    steps: [],
    resumed: null,
    patch: [{ op: 'replace', path: '/inputs', value: 2 }],
    outputs: [
      {
        kind: 'start_call',
        key: openCall,
        function: 'notify',
        arguments_sha256: keptArguments.sha256,
        arguments_bytes: keptArguments.bytes,
        longestMs: 1000,
      },
    ],
    kept,
  });
}

interface Measured {
  readonly byTheEngine: number;
  readonly byTheLedger: number;
  readonly outside: number;
}

function measuredBothWays(kept: readonly Named[]): Measured {
  const event = startingWith(kept);
  const data = writeEvent(event);
  const stored = utf8.encode(JSON.stringify(data)).byteLength;
  const byTheEngine = eventBytesOf(event);
  return {
    byTheEngine,
    byTheLedger: stored + payloadBytesOf(holders, { type: 'input_applied', data }),
    outside: byTheEngine - stored,
  };
}

describe('the record of an input of format 12', () => {
  it('names, through the start’s own place, arguments that no value its patch adds names, so the ledger holds them; and both places when a value it adds is the same text', () => {
    expect(payloadsNamed(writeEvent(startingWith([])), declaration)).toEqual([keptArguments]);
    expect(payloadsNamed(writeEvent(startingWith([keptArguments])), declaration)).toEqual([
      keptArguments,
      keptArguments,
    ]);
  });

  it('is measured by the engine as the ledger measures it: the text of its data and the bytes every declared place names', () => {
    const measured = [measuredBothWays([]), measuredBothWays([keptArguments])];

    expect(measured.map(({ byTheEngine, byTheLedger }) => byTheEngine - byTheLedger)).toEqual([0, 0]);
    expect(measured.map(({ outside }) => outside)).toEqual([20_000, 40_000]);
  });
});
