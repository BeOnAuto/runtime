import { readFileSync } from 'node:fs';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { isRequestRecord, takesAnAnswer } from './request-record.ts';

const DeferralSchema = Schema.fromJsonString(Schema.Struct({ data: Schema.Struct({ record: Schema.JsonObject }) }));

function recordOfTheFixture(path: string): Schema.JsonObject {
  return Schema.decodeUnknownSync(DeferralSchema)(readFileSync(new URL(path, import.meta.url), 'utf8')).data.record;
}

describe('a request a reasoning run recorded when it asked a person to approve an action', () => {
  it('reads as a request that takes an answer, as the release that recorded it wrote it, and not with an approval it cannot read', () => {
    const recorded = recordOfTheFixture('../runs/0.57.0/run_deferred.json');

    expect([
      isRequestRecord(recorded),
      takesAnAnswer(recorded),
      isRequestRecord(Object.fromEntries([...Object.entries(recorded), ['approval', { server: 'browser' }]])),
    ]).toEqual([true, true, false]);
  });
});
