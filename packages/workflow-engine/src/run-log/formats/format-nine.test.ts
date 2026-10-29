import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { snapshotOf, stateFormats, stateInCurrentFormat } from '../../index.ts';
import { runningState } from '../../testing/runs.ts';

const toJson = Schema.decodeUnknownSync(Schema.Json);

const [, , , , , , , , formatNine] = stateFormats.older;

const stateOfFormatNine = toJson(snapshotOf(runningState, 1).state);

const openCall = '"label":"notify the owner","deadline":"3"';

const refusedOnce = { since: 1_791_100_000_000, refusals: 1, waited: 2 };

function withTheCall(replaced: string): Schema.Json {
  return toJson(JSON.parse(JSON.stringify(stateOfFormatNine).replace(openCall, replaced)));
}

describe('a state of format 9', () => {
  it('is a state of format 10 as it is, whose calls were never refused admission', () => {
    expect(formatNine?.format).toBe(9);
    expect(stateInCurrentFormat(9, stateOfFormatNine)).toEqual(runningState);
  });

  it('is read strictly as format 9, so a call tried again after a refusal is refused before it is passed on', () => {
    const triedAgain = withTheCall(`${openCall},"refused":${JSON.stringify(refusedOnce)}`);

    expect(() => stateInCurrentFormat(9, triedAgain)).toThrow(/refused/u);
    expect(JSON.stringify(stateInCurrentFormat(10, triedAgain))).toContain(`"refused":${JSON.stringify(refusedOnce)}`);
  });
});
