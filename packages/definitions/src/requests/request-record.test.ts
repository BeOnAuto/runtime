import { readFileSync } from 'node:fs';

import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { isRequestRecord, takesAnAnswer } from './request-record.ts';

const DeferralSchema = Schema.fromJsonString(Schema.Struct({ data: Schema.Struct({ record: Schema.JsonObject }) }));

function recordOfTheFixture(path: string): Schema.JsonObject {
  return Schema.decodeUnknownSync(DeferralSchema)(readFileSync(new URL(path, import.meta.url), 'utf8')).data.record;
}

function withKey(record: Schema.JsonObject, key: string, value: Schema.Json): Schema.JsonObject {
  return Object.fromEntries([...Object.entries(record), [key, value]]);
}

describe('a request a reasoning run recorded when it asked a person to approve an action', () => {
  it('reads as a request that takes an answer, as the release that recorded it wrote it, and not with an approval it cannot read', () => {
    const recorded = recordOfTheFixture('../runs/0.57.0/run_deferred.json');

    expect([
      isRequestRecord(recorded),
      takesAnAnswer(recorded),
      isRequestRecord(withKey(recorded, 'approval', { server: 'browser' })),
    ]).toEqual([true, true, false]);
  });
});

describe('a request an interaction function recorded when it asked a person to sign in to a site', () => {
  it('reads as a request that takes an answer, and not with a sign-in it cannot read', () => {
    const recorded = {
      to: 'person:user_7kLm2',
      answerer: 'person:user_7kLm2',
      message:
        'The weekly stock check reads your open orders on the supplier portal.\n\nhttps://studio.example/sign-in',
      answer_schema: { type: 'object', properties: { signed_in: { type: 'boolean' } }, required: ['signed_in'] },
      expires_at: '2026-11-05T10:00:00.000Z',
      requested_at: '2026-11-04T10:00:00.000Z',
      sign_in: { server: 'browser', site: 'portal.supplier.example', link: 'https://studio.example/sign-in' },
    };

    expect([
      isRequestRecord(recorded),
      takesAnAnswer(recorded),
      isRequestRecord(withKey(recorded, 'sign_in', { server: 'browser' })),
    ]).toEqual([true, true, false]);
  });
});
