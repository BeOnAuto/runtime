import { Effect } from 'effect';

import type {
  OperatorHintReport,
  ProviderMessageReport,
  ReportOperatorHint,
  ReportProviderMessage,
} from '../adapter/model-access-options.ts';

export const gatewayErrorText = `litellm.NotFoundError: AnthropicException - {"type":"error","error":{"type":"not_found_error","message":"model: no-such-model-xyz"},"request_id":"req_…"}No fallback model group found for lookup_groups=anthropic/no-such-model-xyz. Fallbacks=[{'openai/gpt-5.5': ['openai/gpt-5.4', 'anthropic/claude-sonnet-4-6']}, …]`;

export const gatewayInternals = [
  'litellm',
  'AnthropicException',
  'req_',
  'lookup_groups',
  'Fallbacks',
  'gpt-5.4',
  'claude-sonnet-4-6',
];

export const gatewayError = { error: { message: gatewayErrorText, type: null, param: null, code: '404' } };

export interface RecordingReporter {
  readonly report: ReportProviderMessage;
  readonly reports: () => readonly ProviderMessageReport[];
}

export function recordingReporter(): RecordingReporter {
  const received: ProviderMessageReport[] = [];
  return {
    report: (report) =>
      Effect.sync(() => {
        received.push(report);
      }),
    reports: () => [...received],
  };
}

export interface RecordingHints {
  readonly report: ReportOperatorHint;
  readonly hints: () => readonly OperatorHintReport[];
}

export function recordingHints(): RecordingHints {
  const received: OperatorHintReport[] = [];
  return {
    report: (report) =>
      Effect.sync(() => {
        received.push(report);
      }),
    hints: () => [...received],
  };
}
