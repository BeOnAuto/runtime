import { Conflict, InvalidInput, type NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type { ChatOffered, CredentialGiving, ModelGiven, ModelSetting } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import type { RecordedConnection } from './connection.ts';
import { keptConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type Decision = Result.Result<readonly ConnectionEvent[], NotFound | Conflict | InvalidInput>;

const modelPointer = '/model';

const takesNoModel = 'This connection takes no model, because nothing given here lets members write to Auto.';

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

export function holdsTheChatsCredential(
  { app_credentials: held }: Pick<RecordedConnection, 'app_credentials'>,
  { credential }: ChatOffered,
): boolean {
  return held.some(({ name }) => name === credential);
}

function opensTheChat(chat: ChatOffered | undefined, given: Readonly<Record<string, string>>): boolean {
  return chat !== undefined && Object.hasOwn(given, chat.credential);
}

function issueOfTheModelGiven(name: string, opens: boolean, { notOffered }: ModelGiven): InvalidInput | undefined {
  if (!opens) {
    return modelNotTaken(name, takesNoModel);
  }
  return notOffered === undefined ? undefined : modelNotTaken(name, notOffered);
}

export type ModelAtConnect = Pick<CredentialGiving, 'model' | 'chat'>;

export function modelRefusalAtConnect(
  { connection }: Pick<KeptConnection, 'connection'>,
  { model, chat }: ModelAtConnect,
  given: Readonly<Record<string, string>>,
): InvalidInput | undefined {
  return model === undefined ? undefined : issueOfTheModelGiven(connection.name, opensTheChat(chat, given), model);
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
  if (chat === undefined || !holdsTheChatsCredential(connection, chat)) {
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
