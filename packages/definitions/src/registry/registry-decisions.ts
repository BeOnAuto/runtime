import { Conflict, type Context, type PlaybookAddress, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import { definitionResourceLabel } from '../capability/function-terminology.ts';
import { blankRefusalWhere } from '../imports/blank-refusals.ts';
import type {
  CommandMetadata,
  DefinitionCommand,
  DefinitionCreation,
  DefinitionPause,
  DefinitionRename,
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

export const changedMeanwhile = new Conflict({
  detail: 'The state changed while the command was decided',
  kind: 'concurrent_change',
});

export function retiredToChange(type: string, name: string): Conflict {
  return new Conflict({
    detail: `The ${definitionResourceLabel(type)} ${name} is retired; restore_definition brings it back, and then it can change`,
    kind: 'retired',
  });
}

function isReadAt({ expectedVersion }: { readonly expectedVersion?: number }, existing: StoredDefinition): boolean {
  return expectedVersion === undefined || (existing.version === expectedVersion && !isRetired(existing));
}

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
  update: DefinitionUpdate & CommandMetadata,
  existing: StoredDefinition | undefined,
): Decision {
  const { name, content: given, blanksRefused } = update;
  if (existing === undefined) {
    return Result.fail(definitionNotFound(type, name));
  }
  if (!isReadAt(update, existing)) {
    return Result.fail(changedMeanwhile);
  }
  if (isRetired(existing)) {
    return Result.fail(retiredToChange(type, name));
  }
  const blanked = blankRefusalWhere(blanksRefused === true && existing.status === 'active', given, 'update');
  if (blanked !== undefined) {
    return Result.fail(blanked);
  }
  const content = withTheSavedOverview(given, existing);
  return isAsSaved(content, existing) ? nothingToRecord : recording({ type: 'definition_updated', data: { content } });
}

function decideRename(type: string, rename: DefinitionRename, existing: StoredDefinition | undefined): Decision {
  const { name, new_name: to, renamed_by: renamedBy, content } = rename;
  if (existing === undefined) {
    return Result.fail(definitionNotFound(type, name));
  }
  if (isRetired(existing)) {
    return Result.fail(retiredToChange(type, name));
  }
  if (!isReadAt(rename, existing)) {
    return Result.fail(changedMeanwhile);
  }
  const renamed: DefinitionEvent = { type: 'definition_renamed', data: { from: name, to, renamed_by: renamedBy } };
  return Result.succeed(
    content === undefined ? [renamed] : [renamed, { type: 'definition_updated', data: { content } }],
  );
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
  return { definitionVersion: isASave(command) ? existing.version + 1 : existing.version };
}

function isASave(command: DefinitionCommand): boolean {
  return command.type === 'update' || (command.type === 'rename' && command.content !== undefined);
}

function nameAfter(command: DefinitionCommand): string {
  return command.type === 'rename' ? command.new_name : command.name;
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
  const { by, at } = command;
  return {
    at,
    by,
    definitionType: of.type,
    definitionName: nameAfter(command),
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
  if (command.type === 'rename') {
    return decideRename(type, command, existing);
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
