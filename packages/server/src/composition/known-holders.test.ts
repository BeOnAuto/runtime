import { declaredFact } from '@on.auto/definitions';
import { RunContextSchema, factOf } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { forecastChecked } from '../testing/extensions/declared-facts.ts';
import { factSchemasKnownWith } from './known-facts.ts';
import { factsKnownWith } from './known-holders.ts';

const BytesKeptSchema = factOf('bytes_kept', Schema.Struct({ sha256: Schema.String }), RunContextSchema, {
  content: { holds: ['/sha256'] },
});

const bytesKept = declaredFact('bytes_kept', BytesKeptSchema, ({ type, data }) => ({ type, summary: 'Kept.', data }));

const argumentsHeld = { holds: ['/arguments_sha256'] };

const resultHeld = { holds: ['/result_sha256'] };

const bothHeld = { holds: ['/arguments_sha256', '/result_sha256'] };

describe('the facts the server tells the ledger hold content', () => {
  it('are the facts of every call that keeps what it sent and what it was answered, the facts of a run that may keep its input, output or answer outside it, the assets of generation functions, held until they expire, and each fact a capability declares on runs that holds content', () => {
    const { factSchemas, holders } = factsKnownWith([forecastChecked, bytesKept]);

    expect(factSchemas).toEqual(factSchemasKnownWith([forecastChecked, bytesKept]));
    expect(Object.fromEntries(holders)).toEqual({
      run_started: { payloads: [{ sha256: '/input_sha256', bytes: '/input_bytes' }] },
      run_succeeded: { payloads: [{ sha256: '/output_sha256', bytes: '/output_bytes' }] },
      request_answered: { payloads: [{ sha256: '/answer_sha256', bytes: '/answer_bytes' }] },
      tool_call_started: argumentsHeld,
      tool_call_answered: resultHeld,
      model_call_started: { holds: ['/messages_sha256'] },
      model_call_answered: { holds: ['/response_sha256'] },
      delivery_started: argumentsHeld,
      delivery_succeeded: resultHeld,
      delivery_failed: resultHeld,
      telling_started: argumentsHeld,
      telling_succeeded: resultHeld,
      telling_failed: resultHeld,
      replies_read: bothHeld,
      reading_failed: bothHeld,
      asset_kept: { holds: ['/sha256'] },
      asset_expired: { releases: 'all' },
      bytes_kept: { holds: ['/sha256'] },
    });
  });
});
