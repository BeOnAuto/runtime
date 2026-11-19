import type { Environment } from '@on.auto/config';
import { receivesOver, type ReceivingWay } from '@on.auto/connections';
import { Config, ConfigProvider, Effect, Option } from 'effect';

import { asInvalidSettings } from './invalid-settings-error.ts';
import { WebhookUrl } from './origin.ts';

const webhookUrlVariable = 'WEBHOOK_URL';

export const receivingVariables: readonly string[] = [webhookUrlVariable];

export interface ReceivingSettings {
  readonly overHttp: boolean;
  readonly webhookUrl: string | undefined;
}

const webhookUrlSetting = Config.option(Config.schema(WebhookUrl, webhookUrlVariable));

export function readWebhookUrl(environment: Environment): string | undefined {
  return Option.getOrUndefined(
    Effect.runSync(asInvalidSettings(webhookUrlSetting.parse(ConfigProvider.fromEnvRecord(environment)))),
  );
}

export function readReceivingSettings(
  environment: Environment,
  connections: { readonly receiveEvents: readonly ReceivingWay[] | undefined },
): ReceivingSettings {
  return { overHttp: receivesOver(connections, 'http'), webhookUrl: readWebhookUrl(environment) };
}
