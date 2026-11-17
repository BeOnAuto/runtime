import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { snapshotOf, stateFormat, stateFormats, stateInCurrentFormat } from '../../index.ts';
import { beforeFormatFive, runningState } from '../../testing/runs.ts';

const toJson = Schema.decodeUnknownSync(Schema.Json);

const stateOfNow = snapshotOf(runningState, 1, stateFormat).state;

const stateOfFormatTwo = toJson(
  JSON.parse(JSON.stringify(beforeFormatFive(stateOfNow)).replaceAll('"runId":', '"executionId":')),
);

const failedBranch = '{"type":"runtime","status":500,"instance":"/do/1/fork/branches/2"}';

const openCall = '"label":"notify the owner","deadline":"3"';

const refusedOnce = '"refused":{"since":1791100000000,"refusals":1,"waited":2}';

const refusedWithItsRefusal = refusedOnce.replace(
  '}',
  ',"refusal":{"reason":"conflict","detail":"No credits","kind":"credits_exhausted"}}',
);

const issues = '"issues":[{"detail":"seats, How many seats: expected at least 1.","pointer":"/input/seats"}]';

const heldInline = '"1":{"value":{"ticket":7},"bytes":12}';

const digest = 'b'.repeat(64);

const waitingCall = `"kind":"call","key":{"runId":"0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a","reference":"/do/1/fork/branches/0/ask","run":1},"function":"notify","arguments":1,${openCall}`;

const waitingForAdmission = `"kind":"admission","function":"notify","arguments":1,"label":"notify the owner","timer":"3",${refusedWithItsRefusal}`;

function withText(state: Schema.Json, replaced: string, by: string): Schema.Json {
  const text = JSON.stringify(state);
  expect(text).toContain(replaced);
  return toJson(JSON.parse(text.replace(replaced, by)));
}

const states = { formatTwo: stateOfFormatTwo, now: stateOfNow };

interface Addition {
  readonly format: number;
  readonly what: string;
  readonly state: keyof typeof states;
  readonly replaced: string;
  readonly by: string;
  readonly refused: string;
  readonly kept: string;
}

const additions: readonly Addition[] = [
  {
    format: 2,
    what: 'an error with a kind',
    state: 'formatTwo',
    replaced: failedBranch,
    by: failedBranch.replace('}', ',"kind":"tools_unfinished"}'),
    refused: 'kind',
    kept: '"kind":"tools_unfinished"',
  },
  {
    format: 8,
    what: 'an error that names the issues of a refusal',
    state: 'now',
    replaced: failedBranch,
    by: failedBranch
      .replace('"status":500', `"status":400`)
      .replace('}', `,${issues}}`)
      .replace('runtime', 'validation'),
    refused: 'issues',
    kept: issues,
  },
  {
    format: 9,
    what: 'a call tried again after a refusal',
    state: 'now',
    replaced: openCall,
    by: `${openCall},${refusedOnce}`,
    refused: 'refused',
    kept: refusedOnce,
  },
  {
    format: 10,
    what: 'an error that names its cause',
    state: 'now',
    replaced: failedBranch,
    by: failedBranch.replace('}', ',"cause":{"status":"failed"}}'),
    refused: 'cause',
    kept: '"cause":{"status":"failed"}',
  },
  {
    format: 10,
    what: 'a wait for admission that keeps its refusal',
    state: 'now',
    replaced: waitingCall,
    by: waitingForAdmission,
    refused: 'refusal',
    kept: refusedWithItsRefusal,
  },
  {
    format: 10,
    what: 'a call tried again that keeps its refusal',
    state: 'now',
    replaced: openCall,
    by: `${openCall},${refusedWithItsRefusal}`,
    refused: 'refusal',
    kept: refusedWithItsRefusal,
  },
  {
    format: 11,
    what: 'a value kept outside by its digest',
    state: 'now',
    replaced: heldInline,
    by: `"1":{"sha256":"${digest}","bytes":12}`,
    refused: 'value',
    kept: `"sha256":"${digest}"`,
  },
];

describe('the older formats of a state', () => {
  it('are listed in order, each by its number', () => {
    expect(stateFormats.older.map(({ format }) => format)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it.each([
    [2, 'formatTwo'],
    [8, 'now'],
    [9, 'now'],
    [10, 'now'],
    [11, 'now'],
  ] as const)('pass a state of format %i on as it is', (format, state) => {
    expect(stateInCurrentFormat(format, states[state])).toEqual(runningState);
  });

  it.each(additions)(
    'read a state of format $format strictly, refusing $what, which the format after it keeps',
    ({ format, state, replaced, by, refused, kept }) => {
      const added = withText(states[state], replaced, by);

      expect(() => stateInCurrentFormat(format, added)).toThrow(new RegExp(refused, 'u'));
      expect(JSON.stringify(stateInCurrentFormat(format + 1, added))).toContain(kept);
    },
  );

  it('pass on a wait of format 10 that holds no refusal, as it is', () => {
    expect(
      JSON.stringify(stateInCurrentFormat(10, withText(stateOfNow, openCall, `${openCall},${refusedOnce}`))),
    ).toContain(refusedOnce);
  });

  it('decode a state of 12 strictly, so a value that names both arms, neither, or no digest is refused', () => {
    const both = withText(stateOfNow, heldInline, `"1":{"value":{"ticket":7},"sha256":"${digest}","bytes":12}`);
    const neither = withText(stateOfNow, heldInline, '"1":{"bytes":12}');
    const notADigest = withText(stateOfNow, heldInline, '"1":{"sha256":"B","bytes":12}');

    expect(() => stateInCurrentFormat(12, both)).toThrow(/sha256|value/u);
    expect(() => stateInCurrentFormat(12, neither)).toThrow(/sha256|value/u);
    expect(() => stateInCurrentFormat(12, notADigest)).toThrow(/SHA-256/u);
  });
});
