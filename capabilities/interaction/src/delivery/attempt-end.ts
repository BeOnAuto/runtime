import type { RenderClock } from '@on.auto/definitions/template';
import type { AnsweredOnce, CallAnswered, CallFailed, CalledOnce } from '@on.auto/tool-servers';
import { Struct } from 'effect';

import type { DeliveryEnded } from '../facts/run-facts.ts';
import type { DeliveringRecord } from '../run/request-record.ts';
import { endOfCall } from './call-ends.ts';
import { keptOf } from './sent-messages.ts';

type EndedData<Type extends DeliveryEnded['type']> = Omit<
  Extract<DeliveryEnded, { readonly type: Type }>['data'],
  'number' | 'duration_ms'
>;

export type AttemptEnd =
  | { readonly type: 'delivery_succeeded'; readonly data: EndedData<'delivery_succeeded'> }
  | { readonly type: 'delivery_failed'; readonly data: EndedData<'delivery_failed'> }
  | { readonly type: 'delivery_refused'; readonly data: EndedData<'delivery_refused'> };

export interface RequestAddress {
  readonly org: string;
  readonly playbook: string;
  readonly id: string;
}

function detailOf(detail: string) {
  return detail === '' ? {} : { detail };
}

function answerFieldsOf(answered: CallAnswered) {
  return Struct.omit(answered, ['is_error', 'shown_bytes', 'duration_ms']);
}

function failureFieldsOf(fields: CallAnswered | CallFailed) {
  return 'result_bytes' in fields ? answerFieldsOf(fields) : Struct.omit(fields, ['because', 'detail', 'duration_ms']);
}

function endOfAnswer(called: AnsweredOnce, record: DeliveringRecord, clock: RenderClock): AttemptEnd {
  const end = endOfCall(called);
  if ('answered' in end) {
    return {
      type: 'delivery_succeeded',
      data: { ...answerFieldsOf(end.fields), ...keptOf(record, end.answered, clock) },
    };
  }
  const { because, retryAfterMs, detail, fields } = end.failed;
  return {
    type: 'delivery_failed',
    data: {
      because,
      ...(retryAfterMs === null ? {} : { retry_after_ms: retryAfterMs }),
      ...detailOf(detail),
      ...failureFieldsOf(fields),
    },
  };
}

export function endOf(called: CalledOnce, record: DeliveringRecord, clock: RenderClock): AttemptEnd {
  if (called.kind === 'answered') {
    return endOfAnswer(called, record, clock);
  }
  const { refused, detail } = called;
  return {
    type: 'delivery_failed',
    data: { because: refused === 'tool_not_offered' ? 'tool_not_offered' : 'server_failure', ...detailOf(detail) },
  };
}
