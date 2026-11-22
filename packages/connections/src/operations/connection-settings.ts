import type { Chatting } from './connection-chat.ts';
import type { ConnectionServices } from './connection-services.ts';
import { defineSetConnectionAccountType } from './set-connection-account-type.ts';
import { defineSetConnectionModel } from './set-connection-model.ts';
import { defineSetConnectionPlaybooks } from './set-connection-playbooks.ts';

export function settingOperationsOf(services: Pick<ConnectionServices, 'secrets' | 'providers'>) {
  return [defineSetConnectionPlaybooks(services), defineSetConnectionAccountType(services)];
}

interface ModelSetting {
  readonly chatting: Chatting | undefined;
  readonly operations: readonly ReturnType<typeof defineSetConnectionModel>[];
}

export function modelSettingOf(services: ConnectionServices): ModelSetting {
  const { chatModels } = services;
  if (chatModels === undefined) {
    return { chatting: undefined, operations: [] };
  }
  const setting = defineSetConnectionModel(services, chatModels);
  return { chatting: { models: chatModels, setting: setting.registration }, operations: [setting] };
}
