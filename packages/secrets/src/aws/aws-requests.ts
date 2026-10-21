import type { ProxySettings } from '@on.auto/outbound';
import { awsClientSettingsOf } from '@on.auto/outbound/aws';

import { answerBoundMs } from '../store/answer-bound.ts';

export interface AwsWaits {
  readonly connectionMs: number;
  readonly requestMs: number;
}

export const awsWaits: AwsWaits = { connectionMs: 5000, requestMs: answerBoundMs };

const accountOfAnArn = /arn:aws[\w-]*:[\w-]+:[\w-]*:\d{12}:/gu;

export function wordsWithoutTheAccount(failure: unknown): string {
  return String(failure).replaceAll(accountOfAnArn, '');
}

export function requestHandlerWithin(proxy: ProxySettings, { connectionMs, requestMs }: AwsWaits) {
  const { requestHandler } = awsClientSettingsOf(proxy);
  return {
    ...requestHandler,
    connectionTimeout: connectionMs,
    requestTimeout: requestMs,
    throwOnRequestTimeout: true,
  };
}
