import { Conflict, type NotFound } from '@on.auto/operations';
import { Result } from 'effect';

import type { PlaybooksChoice, PlaybooksSetting } from './connection-commands.ts';
import { servesTheSamePlaybooks } from './connection-entry.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { keptConnectionOf } from './registry-lookup.ts';
import type { KeptConnection, Registry } from './registry.ts';

type Decision = Result.Result<readonly ConnectionEvent[], NotFound | Conflict>;

function eachOnce(playbooks: readonly string[] | null): readonly string[] | null {
  return playbooks === null ? null : [...new Set(playbooks)];
}

function playbooksSetOf(
  { connection }: KeptConnection,
  playbooks: readonly string[] | null,
): readonly ConnectionEvent[] {
  return servesTheSamePlaybooks(connection.entry, playbooks)
    ? []
    : [{ type: 'connection_playbooks_set', data: { connection: connection.id, playbooks: eachOnce(playbooks) } }];
}

export function playbooksChosenOf(kept: KeptConnection, { playbooks }: PlaybooksChoice): readonly ConnectionEvent[] {
  return playbooks === undefined ? [] : playbooksSetOf(kept, playbooks);
}

function usedByNoPlaybook(name: string): Conflict {
  return new Conflict({ detail: `The connection ${name} is removed, so no playbook may use it` });
}

export function decidePlaybooks({ connection, playbooks }: PlaybooksSetting, registry: Registry): Decision {
  return Result.flatMap(keptConnectionOf(registry, connection), (kept): Decision =>
    kept.connection.status === 'removed'
      ? Result.fail(usedByNoPlaybook(kept.connection.name))
      : Result.succeed(playbooksSetOf(kept, playbooks)),
  );
}
