import { Conflict, type Context, type Rejection } from '@on.auto/operations';
import { Result } from 'effect';

import type {
  PlaybookCommand,
  PlaybookCreation,
  PlaybookRetirement,
  PlaybookUpdate,
  CommandMetadata,
} from './playbook-commands.ts';
import type { PlaybookEvent } from './playbook-events.ts';
import type { Playbook } from './playbook.ts';
import { playbookNotFound } from './registry-lookup.ts';
import type { Registry } from './registry.ts';

type Decision = Result.Result<readonly PlaybookEvent[], Rejection<'not_found' | 'conflict'>>;

const nothingToRecord: Decision = Result.succeed([]);

function recording(event: PlaybookEvent): Decision {
  return Result.succeed([event]);
}

function takenBy({ id, status }: Playbook): Conflict {
  return new Conflict({
    detail:
      status === 'active'
        ? `There is already a playbook ${id} in this org`
        : `The playbook ${id} was retired, and a playbook id is never reused`,
    kind: 'taken',
  });
}

function decideCreation({ playbook, name, description, created_by }: PlaybookCreation, registry: Registry): Decision {
  const existing = registry.get(playbook);
  return existing === undefined
    ? recording({ type: 'playbook_created', data: { playbook, name, description, created_by } })
    : Result.fail(takenBy(existing));
}

function decideUpdate({ playbook, name, description }: PlaybookUpdate, registry: Registry): Decision {
  const existing = registry.get(playbook);
  if (existing === undefined) {
    return Result.fail(playbookNotFound(playbook));
  }
  if (existing.status === 'retired') {
    return Result.fail(
      new Conflict({ detail: `The playbook ${playbook} is retired and can no longer change`, kind: 'retired' }),
    );
  }
  const renamed = name !== existing.name;
  const redescribed = description !== existing.description;
  if (!renamed && !redescribed) {
    return nothingToRecord;
  }
  return recording({
    type: 'playbook_updated',
    data: { playbook, ...(renamed ? { name } : {}), ...(redescribed ? { description } : {}) },
  });
}

function decideRetirement({ playbook }: PlaybookRetirement, registry: Registry): Decision {
  const existing = registry.get(playbook);
  if (existing === undefined) {
    return Result.fail(playbookNotFound(playbook));
  }
  return existing.status === 'retired' ? nothingToRecord : recording({ type: 'playbook_retired', data: { playbook } });
}

export function registryContextOf({ by, at }: CommandMetadata): Context {
  return { at, by };
}

export function decideOnRegistry(command: PlaybookCommand, registry: Registry): Decision {
  if (command.type === 'create') {
    return decideCreation(command, registry);
  }
  if (command.type === 'update') {
    return decideUpdate(command, registry);
  }
  return decideRetirement(command, registry);
}
