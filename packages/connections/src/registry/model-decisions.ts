import { Conflict, InvalidInput, type NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type {
  ChatOffered,
  ChatThroughAnAppCredential,
  CredentialGiving,
  ModelGiven,
  ModelSetting,
} from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';
import { keptConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type Decision = Result.Result<readonly ConnectionEvent[], NotFound | Conflict | InvalidInput>;

const modelPointer = '/model';

const takesNoModel = 'This connection takes no model, because nothing given here lets members write to Auto.';

function modelWanted(label: string): string {
  return `Choose a model for this connection. With the ${label}, members can write to Auto, and Auto needs a model to answer them.`;
}

function unconnectedWithoutAModel(name: string, label: string): InvalidInput {
  return new InvalidInput({
    detail: `The connection ${name} needs a model before it can be connected.`,
    issues: [{ pointer: modelPointer, detail: modelWanted(label) }],
  });
}

function modelNotTaken(name: string, detail: string): InvalidInput {
  return new InvalidInput({
    detail: `The connection ${name} cannot take this model.`,
    issues: [{ pointer: modelPointer, detail }],
  });
}

function removedRefusal(name: string): Conflict {
  return new Conflict({ detail: `The connection ${name} is removed, so its model cannot be set.` });
}

function noChatRefusal(name: string): Conflict {
  return new Conflict({ detail: `Members cannot write to Auto through the connection ${name}, so it takes no model.` });
}

export function holdsTheChat(
  { app_credentials: held, status }: Pick<RecordedConnection, 'app_credentials' | 'status'>,
  chat: ChatOffered,
): boolean {
  return chat.through === 'gateway' ? status === 'connected' : held.some(({ name }) => name === chat.credential);
}

function chatOpenedBy(
  chat: ChatOffered | undefined,
  given: Readonly<Record<string, string>>,
): ChatThroughAnAppCredential | undefined {
  return chat?.through === 'app_credential' && Object.hasOwn(given, chat.credential) ? chat : undefined;
}

export function opensTheChat(chat: ChatOffered | undefined, given: Readonly<Record<string, string>>): boolean {
  return chatOpenedBy(chat, given) !== undefined;
}

export function chatOpenedWithoutAModel(
  saved: string | null,
  { model, chat }: Pick<CredentialGiving, 'model' | 'chat'>,
  given: Readonly<Record<string, string>>,
): ChatThroughAnAppCredential | undefined {
  return model === undefined && saved === null ? chatOpenedBy(chat, given) : undefined;
}

function issueOfTheModelGiven(name: string, opens: boolean, { notOffered }: ModelGiven): InvalidInput | undefined {
  if (!opens) {
    return modelNotTaken(name, takesNoModel);
  }
  return notOffered === undefined ? undefined : modelNotTaken(name, notOffered);
}

export type ModelAtConnect = Pick<CredentialGiving, 'model' | 'chat' | 'waitsForAModel'>;

export function modelRefusalAtConnect(
  { connection, model: saved }: Pick<KeptConnection, 'connection' | 'model'>,
  choice: ModelAtConnect,
  given: Readonly<Record<string, string>>,
): InvalidInput | undefined {
  const { model, chat, waitsForAModel } = choice;
  if (model !== undefined) {
    return issueOfTheModelGiven(connection.name, opensTheChat(chat, given), model);
  }
  const waiting = waitsForAModel === true ? chatOpenedWithoutAModel(saved, choice, given) : undefined;
  return waiting === undefined ? undefined : unconnectedWithoutAModel(connection.name, waiting.label);
}

function modelSetOf({ connection, model: saved }: KeptConnection, { model }: ModelGiven): readonly ConnectionEvent[] {
  return model === saved ? [] : [{ type: 'connection_model_set', data: { connection: connection.id, model } }];
}

export function modelChosenAtConnect(kept: KeptConnection, { model }: Pick<CredentialGiving, 'model'>) {
  return model === undefined ? [] : modelSetOf(kept, model);
}

function settingRefusalOf(
  { connection }: KeptConnection,
  { chat, model }: Pick<ModelSetting, 'chat' | 'model'>,
): Conflict | InvalidInput | undefined {
  if (connection.status === 'removed') {
    return removedRefusal(connection.name);
  }
  if (chat === undefined || !holdsTheChat(connection, chat)) {
    return noChatRefusal(connection.name);
  }
  return model.notOffered === undefined ? undefined : modelNotTaken(connection.name, model.notOffered);
}

export function decideModel(command: ModelSetting, registry: Registry): Decision {
  return Result.flatMap(keptConnectionOf(registry, command.connection), (kept): Decision => {
    const refusal = settingRefusalOf(kept, command);
    return refusal === undefined ? Result.succeed(modelSetOf(kept, command.model)) : Result.fail(refusal);
  });
}
