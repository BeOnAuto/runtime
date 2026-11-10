import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { snapshotOf, stateFormat, stateInCurrentFormat } from '../../index.ts';
import { formatEleven } from '../../kept-testing/kept-events.ts';
import { runningState } from '../../testing/runs.ts';

const toJson = Schema.decodeUnknownSync(Schema.Json);

const stateOfFormatEleven = toJson(snapshotOf(runningState, 1, stateFormat).state);

const heldInline = '"1":{"value":{"ticket":7},"bytes":12}';

const keptArm = `"1":{"sha256":"${'b'.repeat(64)}","bytes":12}`;

function withText(replaced: string, by: string): Schema.Json {
  return toJson(JSON.parse(JSON.stringify(stateOfFormatEleven).replace(replaced, by)));
}

describe('a state of format 11', () => {
  it('is a state of format 12 as it is, every value it holds inline', () => {
    expect(formatEleven?.format).toBe(11);
    expect(JSON.stringify(stateOfFormatEleven)).toContain(heldInline);
    expect(stateInCurrentFormat(11, stateOfFormatEleven)).toEqual(runningState);
  });

  it('is checked to hold every value inline before it is passed on as a state of 12, so a value kept outside by its digest is refused', () => {
    const kept = withText(heldInline, keptArm);

    expect(() => stateInCurrentFormat(11, kept)).toThrow(/value/u);
    expect(stateInCurrentFormat(12, kept).machine.values[1]).toEqual({ sha256: 'b'.repeat(64), bytes: 12 });
  });

  it('is then decoded strictly once, as a state of 12, so a value that names both arms or neither is refused', () => {
    const both = withText(heldInline, `"1":{"value":{"ticket":7},"sha256":"${'b'.repeat(64)}","bytes":12}`);
    const neither = withText(heldInline, '"1":{"bytes":12}');
    const notADigest = withText(heldInline, '"1":{"sha256":"B","bytes":12}');

    expect(() => stateInCurrentFormat(12, both)).toThrow(/sha256|value/u);
    expect(() => stateInCurrentFormat(12, neither)).toThrow(/sha256|value/u);
    expect(() => stateInCurrentFormat(12, notADigest)).toThrow(/SHA-256/u);
  });
});
