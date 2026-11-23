import type { ChatOffered } from '../registry/connection-commands.ts';

export interface DefaultModelAnswered {
  readonly default_model?: string;
}

export interface ChatAnswering {
  readonly may: boolean;
  readonly defaultModel: DefaultModelAnswered;
}

export interface ChatHosting {
  readonly opensSockets: boolean;
  readonly throughAGateway: boolean;
}

export function chatThroughOf(offered: ChatOffered, { defaultModel }: ChatAnswering) {
  return offered.through === 'app_credential' ? { credential: offered.credential } : defaultModel;
}
