import { defineHttpOperation, type HttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionWithChatSchema, ModelField } from '../registry/connection.ts';
import { chatAnswerOf, chatOfferedFor, maySetModel, modelGivenOf, type Chatting } from './connection-chat.ts';
import { ConnectionIdField } from './connection-fields.ts';
import type { ChatModels, ConnectionServices } from './connection-services.ts';
import { foundConnection, recordInRegistry } from './registry-access.ts';
import { shownConnection } from './shown-connections.ts';

type Setting = Pick<ConnectionServices, 'secrets' | 'providers' | 'sockets'>;

const description = [
  'Sets the model Auto answers members with when they write to Auto through a connection.',
  'Use list_models to choose the id.',
  'Only an admin may set it. Setting the model the connection already has records nothing.',
  'A removed connection is refused as conflict, and so is a connection through which members cannot write to Auto.',
  'A model this server does not offer is refused as invalid_input.',
].join(' ');

export function defineSetConnectionModel(services: Setting, models: ChatModels) {
  const operation: HttpOperation<'org', 'command'> = defineHttpOperation('org', 'command', {
    name: 'set_connection_model',
    title: 'Set connection model',
    description,
    route: { method: 'PUT', path: '/connections/{id}/model' },
    body: { kind: 'json' },
    repeatable: true,
    connectionsManagement: true,
    inputSchema: Schema.Struct({ id: ConnectionIdField, model: ModelField }),
    outputSchema: ConnectionWithChatSchema,
    reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ id, model }) {
      const chatting: Chatting = { models, setting: operation.registration };
      const chat = chatOfferedFor((yield* foundConnection(services, id)).connection, { ...services, chatting });
      const kept = yield* recordInRegistry(services, {
        type: 'set_model',
        connection: id,
        model: yield* modelGivenOf(model, chatting),
        ...(chat === undefined ? {} : { chat }),
      }).pipe(Effect.catchTag('forbidden', Effect.die));
      const shown = yield* shownConnection(services.secrets, kept);
      return { ...shown, ...chatAnswerOf(kept, chat, yield* maySetModel(chatting)) };
    }),
  });
  return operation;
}
