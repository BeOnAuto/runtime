import { Conflict, type Context, type PlaybookAddress, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { earlierDefinitionIdOf } from '../identity/definition-ids.ts';
import type {
  CommandMetadata,
  DefinitionCommand,
  DefinitionCreation,
  DefinitionPause,
  DefinitionRestoration,
  DefinitionResumption,
  DefinitionRetirement,
  DefinitionUpdate,
} from './definition-commands.ts';
import type { DefinitionEvent } from './definition-events.ts';
import { contentOf, isAsSaved, withTheSavedOverview, type RegisteredDefinition } from './definition-registry.ts';
import { isRetired, type StoredDefinition } from './definition.ts';
import { definitionNotFound } from './registry-lookup.ts';

type Decision = Result.Result<readonly DefinitionEvent[], Rejection<'not_found' | 'conflict'>>;

const nothingToRecord: Decision = Result.succeed([]);

function recording(event: DefinitionEvent): Decision {
  return Result.succeed([event]);
}

function decideCreation(
  { address }: DefinitionsOf,
  { content, created_by, definition_id }: DefinitionCreation & CommandMetadata,
): Decision {
  return recording({
    type: 'definition_created',
    data: { content, created_by, definition_id, playbook: address.playbook },
  });
}

function decideUpdate(
  type: string,
  { name, content: given }: DefinitionUpdate & CommandMetadata,
  existing: StoredDefinition | undefined,
): Decision {
  if (existing === undefined) {
    return Result.fail(definitionNotFound(type, name));
  }
  if (isRetired(existing)) {
    return Result.fail(
      new Conflict({
        detail: `The ${definitionResourceLabel(type)} ${name} is retired; restore it to change it`,
        kind: 'retired',
      }),
    );
  }
  const content = withTheSavedOverview(given, existing);
  return isAsSaved(content, existing) ? nothingToRecord : recording({ type: 'definition_updated', data: { content } });
}

function decideRetirement(
  type: string,
  { name }: DefinitionRetirement & CommandMetadata,
  existing: StoredDefinition | undefined,
): Decision {
  if (existing === undefined) {
    return Result.fail(definitionNotFound(type, name));
  }
  return isRetired(existing) ? nothingToRecord : recording({ type: 'definition_retired', data: {} });
}

function standingToChange(
  type: string,
  name: string,
  existing: StoredDefinition | undefined,
): Result.Result<StoredDefinition, Rejection<'not_found' | 'conflict'>> {
  if (existing === undefined) {
    return Result.fail(definitionNotFound(type, name));
  }
  return isRetired(existing)
    ? Result.fail(
        new Conflict({
          detail: `The ${definitionResourceLabel(type)} ${name} is retired; restore it to pause or resume it`,
          kind: 'retired',
        }),
      )
    : Result.succeed(existing);
}

function decidePause(
  type: string,
  { name, paused_by, reason }: DefinitionPause,
  existing: StoredDefinition | undefined,
): Decision {
  return Result.flatMap(standingToChange(type, name, existing), ({ status }) =>
    status === 'paused'
      ? nothingToRecord
      : recording({ type: 'definition_paused', data: { paused_by, ...(reason === undefined ? {} : { reason }) } }),
  );
}

function decideResumption(
  type: string,
  { name }: DefinitionResumption,
  existing: StoredDefinition | undefined,
): Decision {
  return Result.flatMap(standingToChange(type, name, existing), ({ status }) =>
    status === 'paused' ? recording({ type: 'definition_resumed', data: {} }) : nothingToRecord,
  );
}

function decideRestoration(
  type: string,
  { name, restored_by }: DefinitionRestoration,
  existing: RegisteredDefinition | undefined,
): Decision {
  if (existing === undefined) {
    return Result.fail(definitionNotFound(type, name));
  }
  return isRetired(existing)
    ? recording({ type: 'definition_restored', data: { content: contentOf(existing), restored_by } })
    : nothingToRecord;
}

function versionSaved(
  command: DefinitionCommand,
  existing: StoredDefinition | undefined,
): Pick<Context, 'definitionVersion'> {
  if (command.type === 'create') {
    return { definitionVersion: 1 };
  }
  if (existing === undefined) {
    return {};
  }
  return { definitionVersion: command.type === 'update' ? existing.version + 1 : existing.version };
}

function idOf(
  { type, address }: DefinitionsOf,
  command: DefinitionCommand,
  existing: RegisteredDefinition | undefined,
): string {
  if (command.type === 'create') {
    return command.definition_id;
  }
  return existing?.definition_id ?? earlierDefinitionIdOf({ ...address, type, name: command.name });
}

export interface DefinitionsOf {
  readonly type: string;
  readonly address: PlaybookAddress;
}

export function definitionContextOf(
  of: DefinitionsOf,
  command: DefinitionCommand,
  existing: RegisteredDefinition | undefined,
): Context {
  const { by, at, name } = command;
  return {
    at,
    by,
    definitionType: of.type,
    definitionName: name,
    ...versionSaved(command, existing),
    definitionId: idOf(of, command, existing),
  };
}

export function decideOnDefinition(
  { type, address }: DefinitionsOf,
  command: DefinitionCommand,
  existing: RegisteredDefinition | undefined,
): Decision {
  if (command.type === 'create') {
    return decideCreation({ type, address }, command);
  }
  if (command.type === 'update') {
    return decideUpdate(type, command, existing);
  }
  if (command.type === 'pause') {
    return decidePause(type, command, existing);
  }
  if (command.type === 'resume') {
    return decideResumption(type, command, existing);
  }
  return command.type === 'restore'
    ? decideRestoration(type, command, existing)
    : decideRetirement(type, command, existing);
}
