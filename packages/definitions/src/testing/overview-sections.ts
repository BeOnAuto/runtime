import type { Schema } from 'effect';

import { encodedOverview, type Overview, type Phrases } from '../overview/overview.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import { overviewReadFrom } from '../used-by/overview-at-read.ts';

export interface HeldDefinition {
  readonly type: string;
  readonly name: string;
  readonly status?: 'active' | 'retired';
  readonly description?: string;
  readonly details?: Schema.JsonObject;
}

export interface DefinitionToRead extends HeldDefinition {
  readonly overview: Overview;
}

const heldAt = '2026-10-01T09:00:00.000Z';

export function sectionIn(overview: string, heading: string): string {
  return overview.split(`## ${heading}\n\n`)[1]?.split('\n\n## ')[0] ?? '';
}

export function overviewTitled(title: string, ...opening: Phrases): Overview {
  return { title, opening, body: [], sections: [], appendix: [] };
}

function storedOf({ name, status = 'active', description, details, overview }: DefinitionToRead): StoredDefinition {
  return {
    name,
    version: 1,
    status,
    source: '',
    overview: encodedOverview(overview),
    created_at: heldAt,
    created_by: 'acme-admin',
    updated_at: heldAt,
    ...(description === undefined ? {} : { description }),
    ...(details === undefined ? {} : { details }),
  };
}

export function overviewAsRead(read: DefinitionToRead, held: readonly HeldDefinition[] = []): string {
  const playbook = [read, ...held.map((definition) => ({ ...definition, overview: overviewTitled(definition.name) }))];
  const registries = new Map(
    [...Map.groupBy(playbook, ({ type }) => type)].map(
      ([type, definitions]: readonly [string, readonly DefinitionToRead[]]) => [
        type,
        new Map(definitions.map((definition) => [definition.name, storedOf(definition)])),
      ],
    ),
  );
  return overviewReadFrom(registries, read.type, storedOf(read));
}
