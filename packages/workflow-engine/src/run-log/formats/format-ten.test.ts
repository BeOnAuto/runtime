import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { snapshotOf, stateFormats, stateInCurrentFormat } from '../../index.ts';
import { runningState } from '../../testing/runs.ts';

const toJson = Schema.decodeUnknownSync(Schema.Json);

const [, , , , , , , , , formatTen] = stateFormats.older;

const stateOfFormatTen = toJson(snapshotOf(runningState, 1).state);

const failedBranch = '{"type":"runtime","status":500,"instance":"/do/1/fork/branches/2"}';

const openCall = '"label":"notify the owner","deadline":"3"';

const refusedOnce = '"refused":{"since":1791100000000,"refusals":1,"waited":2}';

const refusal = '"refusal":{"reason":"conflict","detail":"No credits","kind":"credits_exhausted"}';

const refusedWithItsRefusal = refusedOnce.replace('}', `,${refusal}}`);

function withText(replaced: string, by: string): Schema.Json {
  return toJson(JSON.parse(JSON.stringify(stateOfFormatTen).replace(replaced, by)));
}

describe('a state of format 10', () => {
  it('is a state of format 11 as it is, whose errors name no cause and whose waits hold no refusal', () => {
    expect(formatTen?.format).toBe(10);
    expect(stateInCurrentFormat(10, stateOfFormatTen)).toEqual(runningState);
    expect(JSON.stringify(stateInCurrentFormat(10, withText(openCall, `${openCall},${refusedOnce}`)))).toContain(
      refusedOnce,
    );
  });

  it('is read strictly as format 10, so an error that names its cause is refused before it is passed on', () => {
    const caused = withText(failedBranch, failedBranch.replace('}', ',"cause":{"status":"failed"}}'));

    expect(() => stateInCurrentFormat(10, caused)).toThrow(/cause/u);
    expect(JSON.stringify(stateInCurrentFormat(11, caused))).toContain('"cause":{"status":"failed"}');
  });

  it('is read strictly as format 10, so a wait for admission that keeps its refusal is refused before it is passed on', () => {
    const waiting = withText(
      `"kind":"call","key":{"runId":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","reference":"/do/1/fork/branches/0/ask","run":1},"function":"notify","arguments":1,${openCall}`,
      `"kind":"admission","function":"notify","arguments":1,"label":"notify the owner","timer":"3",${refusedWithItsRefusal}`,
    );

    expect(() => stateInCurrentFormat(10, waiting)).toThrow(/refusal/u);
    expect(JSON.stringify(stateInCurrentFormat(11, waiting))).toContain(refusedWithItsRefusal);
  });

  it('is read strictly as format 10, so a call tried again that keeps its refusal is refused before it is passed on', () => {
    const tried = withText(openCall, `${openCall},${refusedWithItsRefusal}`);

    expect(() => stateInCurrentFormat(10, tried)).toThrow(/refusal/u);
    expect(JSON.stringify(stateInCurrentFormat(11, tried))).toContain(refusedWithItsRefusal);
  });
});
