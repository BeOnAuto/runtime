import type { ProviderList } from '@on.auto/providers';

import { decideAppCredentialRefusal } from './app-credential-decisions.ts';
import type { CommandDecidedApart, CommandMetadata, ConnectionCommand } from './connection-commands.ts';
import { decideIdentification } from './identity-decisions.ts';
import { decideModel } from './model-decisions.ts';
import { decidePlaceNaming } from './place-name-decisions.ts';
import type { Decision } from './registry-decisions.ts';
import type { Registry } from './registry.ts';
import { decideOnItsRequest } from './request-decisions.ts';
import { decideOnItsWay } from './way-decisions.ts';

type DecidedApart = CommandDecidedApart & CommandMetadata;

const typesDecidedApart: ReadonlySet<string> = new Set([
  'refuse_app_credential',
  'identify',
  'name_place',
  'set_account_type',
  'set_model',
  'choose_way',
  'record_service_account',
  'request',
  'decline',
]);

export function isDecidedApart(command: ConnectionCommand): command is DecidedApart {
  return typesDecidedApart.has(command.type);
}

export function decideApart(command: DecidedApart, registry: Registry, providers: ProviderList): Decision {
  if (command.type === 'refuse_app_credential') {
    return decideAppCredentialRefusal(command, registry);
  }
  if (
    command.type === 'set_account_type' ||
    command.type === 'choose_way' ||
    command.type === 'record_service_account'
  ) {
    return decideOnItsWay(command, registry, providers);
  }
  if (command.type === 'request' || command.type === 'decline') {
    return decideOnItsRequest(command, registry);
  }
  if (command.type === 'set_model') {
    return decideModel(command, registry);
  }
  return command.type === 'name_place' ? decidePlaceNaming(command, registry) : decideIdentification(command, registry);
}
