import { readFileSync } from 'node:fs';

import { ConflictKindSchema, factOf, RunContextSchema } from '@on.auto/operations';
import { payloadFields, withPayloads } from '@on.auto/operations/payloads';
import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

const becausesBeforeTheLimits = Schema.Literals([
  'provider_not_configured',
  'model_not_allowed',
  'tool_server_not_configured',
  'tool_not_allowed',
  'tool_not_listed',
  'connection_pending',
  'connection_broken',
  'connection_not_allowed',
  'connection_unavailable',
  'failing',
  'rate_limited',
  'unreachable',
  'key_refused',
  'scope_lacking',
  'server_failed',
  'tool_error',
  'model_unavailable',
  'definition_refused',
  'run_bound',
  'no_answer',
  'restarted_without_content',
  'input_missing',
  'answer_missing',
  'workflow_document_missing',
  'function_document_missing',
  'call_outcome_unknown',
  'only_read',
  'stalled',
  'none_left',
  'free_daily_limit',
  'free_month_used',
  'key_rotated',
  'installation_revoked',
  'org_deleted',
  'org_purged',
]);

const SucceededBeforeTheLimits = factOf(
  'run_succeeded',
  withPayloads(Schema.Struct({ ...payloadFields('output', Schema.Json), record: Schema.JsonObject }), ['output']),
  RunContextSchema,
);

const ConflictBeforeTheLimits = factOf(
  'run_rejected',
  Schema.Struct({
    rejection: Schema.Struct({
      reason: Schema.Literal('conflict'),
      detail: Schema.String,
      kind: Schema.optionalKey(ConflictKindSchema),
      because: Schema.optionalKey(becausesBeforeTheLimits),
    }),
    record: Schema.optionalKey(Schema.JsonObject),
  }),
  RunContextSchema,
);

function textIn(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function recordedIn(path: string): unknown {
  return JSON.parse(textIn(path));
}

const succeededBefore = Schema.decodeUnknownResult(Schema.toCodecJson(SucceededBeforeTheLimits));

const rejectedBefore = Schema.decodeUnknownResult(Schema.toCodecJson(ConflictBeforeTheLimits));

const onTheRun = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'key_7f3a',
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'reasoning',
  definitionName: 'qualify-lead',
  definitionVersion: 2,
};

describe('a run that answered at a limit, as a release before the readers of limits reads it', () => {
  it('reads the success recorded in 0.61.0 through that release’s schema, passing over the limit it does not know', () => {
    expect(Result.getOrThrow(succeededBefore(recordedIn('0.61.0/run_succeeded.json')))).toEqual({
      type: 'run_succeeded',
      data: { output: { score: 0.6 }, record: {} },
      context: onTheRun,
    });
  });
});

describe('a run stopped at a limit, as a release before the readers of limits reads it', () => {
  it('is not read, since its because is one that release does not know, so the readers ship before anything writes it', () => {
    const recorded = textIn('0.61.0/run_rejected.json');
    const ofABecauseItKnows: unknown = JSON.parse(
      recorded.replace('"because": "max_tool_calls"', '"because": "run_bound"'),
    );

    expect([
      Result.isFailure(rejectedBefore(recordedIn('0.61.0/run_rejected.json'))),
      Result.isSuccess(rejectedBefore(ofABecauseItKnows)),
    ]).toEqual([true, true]);
  });
});
