import type { KeptContent, PresentedFact } from '@on.auto/operations';
import { Option, Schema } from 'effect';

import { modelAnswered, modelCalled, modelFailed } from '../plain-language/event-words.ts';
import type { AskedToolCall, ModelWarning } from '../run-work/model-call-facts.ts';
import type { RecordedRunFact } from '../runs/run-events.ts';
import { cutAtCodePoint, mostDetailBytes, mostNameBytes } from './event-data.ts';

export type ModelCallShown = RecordedRunFact<'model_call_started' | 'model_call_answered' | 'model_call_failed'>;

const mostDigestBytes = 128;

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Json));

function named(text: string): string {
  return cutAtCodePoint(text, mostNameBytes);
}

function keptJson(
  name: string,
  digest: string | undefined,
  content: KeptContent,
): Readonly<Record<string, Schema.Json>> {
  const text = digest === undefined ? undefined : content(digest);
  if (text === undefined) {
    return {};
  }
  return Option.match(decodeJson(text), { onNone: () => ({}), onSome: (value) => ({ [name]: value }) });
}

function digestNamed(name: string, digest: string | undefined): Readonly<Record<string, string>> {
  return digest === undefined ? {} : { [`${name}_sha256`]: cutAtCodePoint(digest, mostDigestBytes) };
}

function askedShown({ call_id, tool, server, arguments_sha256 }: AskedToolCall): Schema.JsonObject {
  return {
    call_id: named(call_id),
    tool: named(tool),
    server: named(server),
    ...digestNamed('arguments', arguments_sha256),
  };
}

function startedShown({ data }: RecordedRunFact<'model_call_started'>, content: KeptContent): PresentedFact {
  const { number, model, messages_bytes, messages_sha256, tools_offered } = data;
  return {
    type: 'model_call_started',
    summary: modelCalled(number, tools_offered),
    data: {
      number,
      model: named(model),
      messages_bytes,
      ...digestNamed('messages', messages_sha256),
      tools_offered,
      ...keptJson('messages', messages_sha256, content),
    },
  };
}

function warningShown({ type, feature, detail }: ModelWarning): Schema.JsonObject {
  return {
    type,
    feature: feature === null ? null : named(feature),
    detail: detail === null ? null : cutAtCodePoint(detail, mostDetailBytes),
  };
}

function answeredShown({ data }: RecordedRunFact<'model_call_answered'>, content: KeptContent): PresentedFact {
  const { raw_finish_reason, response_id, response_sha256, tool_calls, warnings, ...counts } = data;
  return {
    type: 'model_call_answered',
    summary: modelAnswered(data.number, tool_calls.length),
    data: {
      ...counts,
      raw_finish_reason: raw_finish_reason === null ? null : named(raw_finish_reason),
      response_id: response_id === null ? null : named(response_id),
      resolved_model: named(data.resolved_model),
      answered_model: named(data.answered_model),
      warnings: warnings.map((warning) => warningShown(warning)),
      ...digestNamed('response', response_sha256),
      tool_calls: tool_calls.map((asked) => askedShown(asked)),
      ...keptJson('response', response_sha256, content),
    },
  };
}

function wordsShown(name: string, words: string | undefined): Readonly<Record<string, string>> {
  return words === undefined ? {} : { [name]: cutAtCodePoint(words, mostDetailBytes) };
}

function failedShown({ data }: RecordedRunFact<'model_call_failed'>): PresentedFact {
  const { detail, provider_message: providerMessage, issues, ...rest } = data;
  return {
    type: 'model_call_failed',
    summary: modelFailed(data.number, data.because),
    data: {
      ...rest,
      provider: named(data.provider),
      ...wordsShown('detail', detail),
      ...wordsShown('provider_message', providerMessage),
      ...(issues === undefined
        ? {}
        : {
            issues: issues.map(({ pointer, detail: said }) => ({
              pointer: named(pointer),
              detail: cutAtCodePoint(said, mostDetailBytes),
            })),
          }),
    },
  };
}

export function modelCallFact(event: ModelCallShown, content: KeptContent): PresentedFact {
  if (event.type === 'model_call_started') {
    return startedShown(event, content);
  }
  return event.type === 'model_call_answered' ? answeredShown(event, content) : failedShown(event);
}
