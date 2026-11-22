import { Caller, Forbidden, mayCallEach, type Runnable } from '@on.auto/operations';
import { providerFoundBy } from '@on.auto/providers';
import { Effect } from 'effect';

import { offeredAppCredentialsOf } from '../providers/provider-listing.ts';
import type { ChatOffered, ModelGiven } from '../registry/connection-commands.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import { holdsTheChatsCredential } from '../registry/model-decisions.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { wayOfTheConnection } from '../registry/what-connections-act-as.ts';
import { opensSockets, type ChatModels, type ConnectionServices } from './connection-services.ts';

export interface Chatting {
  readonly models: ChatModels;
  readonly setting: Runnable<'org'>;
}

export type ChatReading = Pick<ConnectionServices, 'providers' | 'sockets'> & {
  readonly chatting: Chatting | undefined;
};

const modelForAdmins = new Forbidden({
  detail: 'Only admins can choose the model of a connection.',
  kind: 'permission_denied',
});

export function chatOfferedFor(
  connection: Pick<RecordedConnection, 'provider' | 'credential'>,
  reading: ChatReading,
): ChatOffered | undefined {
  const provider = reading.chatting === undefined ? undefined : providerFoundBy(reading.providers, connection.provider);
  const way = wayOfTheConnection(connection, reading.providers);
  if (provider?.entry.chat === undefined || way === undefined) {
    return undefined;
  }
  const opening = offeredAppCredentialsOf(provider, way, { opensSockets: opensSockets(reading) }).find(
    ({ destination }) => destination.chat !== undefined,
  );
  return opening === undefined ? undefined : { credential: opening.credential.name };
}

export const maySetModel = Effect.fnUntraced(function* ({ setting }: Chatting) {
  const caller = yield* Caller;
  const [may] = yield* mayCallEach([{ operation: setting, caller, org: caller.org }]);
  return may === true;
});

interface ChatAnswer {
  readonly chat?: {
    readonly credential: string;
    readonly held: boolean;
    readonly model: string | null;
    readonly may_set_model: boolean;
  };
}

export function chatAnswerOf(kept: KeptConnection, offered: ChatOffered | undefined, may: boolean): ChatAnswer {
  return offered === undefined
    ? {}
    : {
        chat: {
          credential: offered.credential,
          held: holdsTheChatsCredential(kept.connection, offered),
          model: kept.model,
          may_set_model: may,
        },
      };
}

function answeredOf(kept: KeptConnection, reading: ChatReading): ChatOffered | undefined {
  return kept.connection.status === 'removed' ? undefined : chatOfferedFor(kept.connection, reading);
}

export const chatsAnsweredOf = Effect.fnUntraced(function* (kept: readonly KeptConnection[], reading: ChatReading) {
  const offered = kept.map((each) => answeredOf(each, reading));
  const { chatting } = reading;
  const may = chatting !== undefined && offered.some((each) => each !== undefined) && (yield* maySetModel(chatting));
  return kept.map((each, at) => chatAnswerOf(each, offered[at], may));
});

export function modelGivenOf(model: string, { models }: Chatting): Effect.Effect<ModelGiven> {
  return Effect.map(models.refusalOf(model), (notOffered) =>
    notOffered === undefined ? { model } : { model, notOffered },
  );
}

export function mayChooseTheModel(chatting: Chatting) {
  return Effect.flatMap(maySetModel(chatting), (may) => (may ? Effect.void : Effect.fail(modelForAdmins)));
}
