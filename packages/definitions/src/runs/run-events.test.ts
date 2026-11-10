import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { keptFactsWritten } from '../testing/kept-facts-written.ts';
import { RunEventSchema } from './run-events.ts';

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'key_7f3a' };

const caller = { id: 'key_7f3a', name: 'key_7f3a' };

const onTheRun = {
  ...acted,
  runId: '019a3c4e-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  definitionType: 'reasoning',
  definitionName: 'qualify-lead',
  definitionVersion: 2,
};

const calledByAWorkflow = {
  ...onTheRun,
  calledBy: { runId: '019a3c4e-1111-7c1a-9b3f-2f1e0d9c8b7a', reference: '/do/0/qualify', run: 1 },
  callDepth: 1,
  depth: 1,
  trigger: { kind: 'event', reference: '/schedule/on' },
} as const;

const usage = {
  input: { total: 1200, uncached: 200, cache_read: 1000, cache_write: 0 },
  output: { total: 300, text: 250, reasoning: 50 },
  total: 1500,
};

const toolCall = { number: 1, call_id: 'call-1', server: 'crm', tool: 'find_contact' };

const modelCall = { number: 2 };

const baseline: readonly (typeof RunEventSchema.Type)[] = [
  {
    type: 'run_started',
    data: {
      input: { lead: 'lead-1' },
      started_by: caller,
      calls_tools: true,
      finishes_later: true,
      resumes: true,
      output_shape: 'table',
    },
    context: calledByAWorkflow,
  },
  { type: 'run_deferred', data: { record: { waiting_for: 'reply' } }, context: onTheRun },
  { type: 'attempt_resumed', data: { attempt: 2 }, context: onTheRun },
  { type: 'run_succeeded', data: { output: { score: 0.8 }, record: { steps: 3 } }, context: onTheRun },
  {
    type: 'run_rejected',
    data: {
      rejection: {
        reason: 'invalid_input',
        detail: 'The input has no lead',
        issues: [{ detail: 'Expected a string', pointer: '/lead' }],
        kind: 'input_schema',
      },
      record: { checked: true },
    },
    context: onTheRun,
  },
  { type: 'run_failed', data: { incident: 'incident-1' }, context: onTheRun },
  {
    type: 'run_cancel_requested',
    data: { kind: 'requested', reason: 'The lead was closed' },
    context: { ...acted, runId: onTheRun.runId },
  },
  {
    type: 'tool_call_started',
    data: {
      ...toolCall,
      connection_id: 'connection-1',
      arguments_bytes: 24,
      arguments_sha256: 'a1b2c3',
      read_only: true,
    },
    context: onTheRun,
  },
  {
    type: 'tool_call_answered',
    data: {
      number: 1,
      is_error: false,
      result_bytes: 512,
      result_sha256: 'd4e5f6',
      shown_bytes: 256,
      duration_ms: 140,
      jsonrpc_id: 7,
      server_request_id: 'request-1',
    },
    context: onTheRun,
  },
  {
    type: 'tool_call_failed',
    data: {
      number: 1,
      because: 'server_failure',
      detail: 'The server answered 502',
      duration_ms: 90,
      jsonrpc_id: null,
      server_request_id: null,
      rate_limited: true,
    },
    context: onTheRun,
  },
  {
    type: 'model_call_started',
    data: {
      ...modelCall,
      model: 'example/model-large',
      messages_bytes: 4096,
      messages_sha256: 'a7b8c9',
      tools_offered: 3,
    },
    context: onTheRun,
  },
  {
    type: 'model_call_answered',
    data: {
      ...modelCall,
      finish_reason: 'tool_calls',
      raw_finish_reason: 'tool_use',
      usage,
      cost_usd: 0.012,
      response_id: 'response-1',
      duration_ms: 2100,
      request_bytes: 5000,
      response_bytes: 800,
      response_sha256: 'b1c2d3',
      resolved_model: 'model-large-1',
      answered_model: 'model-large-1',
      warnings: [{ type: 'unsupported', feature: 'seed', detail: null }],
      tool_calls: [{ call_id: 'call-2', tool: 'find_contact', server: 'crm', arguments_sha256: 'e4f5a6' }],
    },
    context: onTheRun,
  },
  {
    type: 'model_call_failed',
    data: {
      ...modelCall,
      because: 'output_invalid',
      provider: 'example',
      detail: 'The answer does not match the output schema',
      duration_ms: 1900,
      usage,
      cost_usd: 0.01,
      finish_reason: 'stop',
      retry_after_ms: 1000,
      provider_message: 'Overloaded',
      issues: [{ pointer: '/score', detail: 'Expected a number' }],
    },
    context: onTheRun,
  },
  {
    type: 'request_answered',
    data: {
      answer: { approved: true },
      claimed_for: 'request-1',
      reply: { id: 'reply-1', sender: 'sender-1' },
      answered_by: caller,
    },
    context: onTheRun,
  },
];

const actingForAPerson: readonly (typeof RunEventSchema.Type)[] = [
  {
    type: 'run_started',
    data: {
      input: { schedule: { due: '2026-11-02T09:00:00.000Z' } },
      started_by: { id: 'playbook:sales', name: 'sales' },
      finishes_later: true,
    },
    context: {
      at: '2026-11-02T09:00:00.214Z',
      by: 'playbook:sales',
      runId: '019a4b2c-1d3e-7f40-8a51-6b7c8d9e0f1a',
      definitionType: 'workflow',
      definitionName: 'weekly-stock-check',
      definitionVersion: 4,
      depth: 1,
      trigger: { kind: 'cron', reference: '/schedule/cron' },
      actsFor: 'person:user_7kLm2',
    },
  },
];

const approvalAsked = {
  request: 'approval-1',
  tool: 'browser_click',
  digest: 'sha256-of-the-arguments',
  action: 'Click "Pay now"',
  expires_at: '2026-11-05T10:05:00.000Z',
  site: 'shop.example',
};

const askedToApproveAnAction: readonly (typeof RunEventSchema.Type)[] = [
  {
    type: 'run_deferred',
    data: {
      record: {
        to: 'person:user_7kLm2',
        answerer: 'person:user_7kLm2',
        message: 'qualify-lead needs your approval for this action, through the browser_click tool of browser',
        answer_schema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'] },
        expires_at: approvalAsked.expires_at,
        requested_at: '2026-11-05T10:00:00.000Z',
        approval: { server: 'browser', tool: 'browser_click', action: approvalAsked.action, site: approvalAsked.site },
        call: { number: 2, call_id: 'toolu_1', last_call: 3, last_model_call: 1, asked: approvalAsked },
        spent: { usage: { total: 120 }, duration_ms: 900 },
      },
    },
    context: { ...onTheRun, at: '2026-11-05T10:00:00.000Z' },
  },
];

const signInDeclined = {
  reason: 'unanswered',
  kind: 'declined',
  detail: 'The interaction function portal-sign-in went unanswered, at the step sign-in: Priya did not sign in.',
  cause: { step: 'do/0/sign-in', run_id: onTheRun.runId, status: 'rejected', reason: 'unanswered', kind: 'declined' },
} as const;

const declinedASignInAtAStep: readonly (typeof RunEventSchema.Type)[] = [
  {
    type: 'run_rejected',
    data: { rejection: signInDeclined },
    context: { ...onTheRun, runId: calledByAWorkflow.calledBy.runId, definitionType: 'workflow' },
  },
];

const answeredInEachMode: readonly (typeof RunEventSchema.Type)[] = [
  {
    type: 'model_call_answered',
    data: {
      number: 1,
      finish_reason: 'stop',
      raw_finish_reason: 'stop',
      usage,
      cost_usd: 0.0004,
      response_id: 'chatcmpl-1',
      duration_ms: 1400,
      request_bytes: 1800,
      response_bytes: 120,
      response_sha256: 'c4d5e6',
      resolved_model: 'gateway/model-small',
      answered_model: 'model-small-2',
      warnings: [],
      tool_calls: [],
      output_mode: 'described',
      repair: {
        outcome: 'repaired',
        issues: [{ pointer: '/verdict', detail: 'Expected string' }],
        usage: {
          input: { total: 600, uncached: 100, cache_read: 500, cache_write: 0 },
          output: { total: 150, text: 125, reasoning: 25 },
          total: 750,
        },
        cost_usd: 0.0002,
        duration_ms: 700,
      },
      schema_refusal: { outcome: 'described', status: 400, duration_ms: 300 },
    },
    context: onTheRun,
  },
  {
    type: 'model_call_failed',
    data: {
      number: 1,
      because: 'output_invalid',
      provider: 'gateway',
      detail: 'The answer is not JSON',
      duration_ms: 1300,
      usage,
      finish_reason: 'stop',
      issues: [],
      output_mode: 'portable',
      repair: { outcome: 'skipped', because: 'input_tokens' },
    },
    context: onTheRun,
  },
];

const keptOutside = await keptFactsWritten();

describe('the facts a playbook records on the stream of a run', () => {
  recordedFactsBehaviour({
    schema: RunEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.46.0': baseline,
      '0.57.0': [...actingForAPerson, ...askedToApproveAnAction, ...declinedASignInAtAStep, ...answeredInEachMode],
      '0.58.0': keptOutside,
    },
  });
});
