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

const documentKept = [
  { sha256: '/content/source_sha256', bytes: '/content/source_bytes' },
  { sha256: '/content/overview_sha256', bytes: '/content/overview_bytes' },
  { sha256: '/content/diagram_sha256', bytes: '/content/diagram_bytes' },
];

describe('the facts the server tells the ledger hold content', () => {
  it('are the saved versions of a definition that may keep its document, overview and diagram outside them, the facts of every call that keeps what it sent and what it was answered, the facts of a run that may keep its input, output, answer or the prompt its record holds outside it, the assets of generation functions, held until they expire, the record of each input a workflow applies, which names the values it keeps outside, and each fact a capability declares on runs that holds content', () => {
    const { factSchemas, holders } = factsKnownWith([forecastChecked, bytesKept]);

    expect(factSchemas).toEqual(factSchemasKnownWith([forecastChecked, bytesKept]));
    expect(Object.fromEntries(holders)).toEqual({
      definition_created: { payloads: documentKept },
      definition_updated: { payloads: documentKept },
      definition_restored: { payloads: documentKept },
      run_started: { payloads: [{ sha256: '/input_sha256', bytes: '/input_bytes' }] },
      run_succeeded: {
        payloads: [
          { sha256: '/output_sha256', bytes: '/output_bytes' },
          { sha256: '/record/prompt_sha256', bytes: '/record/prompt_bytes' },
        ],
      },
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
      input_applied: {
        payloads: [
          { sha256: '/kept/*/sha256', bytes: '/kept/*/bytes' },
          { sha256: '/outputs/*/arguments_sha256', bytes: '/outputs/*/arguments_bytes' },
        ],
      },
      bytes_kept: { holds: ['/sha256'] },
    });
  });
});
