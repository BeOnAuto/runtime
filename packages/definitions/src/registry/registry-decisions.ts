import { Conflict, type Context, type PlaybookAddress, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { blankRefusalWhere } from '../imports/blank-refusals.ts';
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
  { type, address }: DefinitionsOf,
  { content, created_by, definition_id, paused, blanksRefused }: DefinitionCreation & CommandMetadata,
  existing: StoredDefinition | undefined,
): Decision {
  if (existing !== undefined) {
    return Result.fail(
      new Conflict({
        detail: `The playbook already has the ${definitionResourceLabel(type)} ${existing.name}`,
        kind: 'taken',
      }),
    );
  }
  const blanked = blankRefusalWhere(blanksRefused === true && paused === undefined, content, 'create');
  return blanked === undefined
    ? recording({
        type: 'definition_created',
        data: {
          content,
          created_by,
          definition_id,
          playbook: address.playbook,
          ...(paused === undefined ? {} : { paused }),
        },
      })
    : Result.fail(blanked);
}

function decideUpdate(
  type: string,
  { name, content: given, blanksRefused }: DefinitionUpdate & CommandMetadata,
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
  const blanked = blankRefusalWhere(blanksRefused === true && existing.status === 'active', given, 'update');
  if (blanked !== undefined) {
    return Result.fail(blanked);
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

function resumedUnlessBlanked(existing: StoredDefinition, blanksRefused: boolean | undefined): Decision {
  if (existing.status !== 'paused') {
    return nothingToRecord;
  }
  const blanked = blankRefusalWhere(blanksRefused, existing, 'resume');
  return blanked === undefined ? recording({ type: 'definition_resumed', data: {} }) : Result.fail(blanked);
}

function decideResumption(
  type: string,
  { name, blanksRefused }: DefinitionResumption,
  existing: StoredDefinition | undefined,
): Decision {
  return Result.flatMap(standingToChange(type, name, existing), (standing) =>
    resumedUnlessBlanked(standing, blanksRefused),
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

export interface DefinitionsOf {
  readonly type: string;
  readonly address: PlaybookAddress;
  readonly definition: string;
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
    definitionId: of.definition,
  };
}

export function decideOnDefinition(
  of: DefinitionsOf,
  command: DefinitionCommand,
  existing: RegisteredDefinition | undefined,
): Decision {
  const { type } = of;
  if (command.type === 'create') {
    return decideCreation(of, command, existing);
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
