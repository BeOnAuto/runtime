import { Predicate, Schema } from 'effect';

import { PlaybookIdSchema } from './identifiers.ts';

export const PlaybookAccessSchema = Schema.Union([Schema.Literal('*'), Schema.Array(PlaybookIdSchema)]);

export type PlaybookAccess = typeof PlaybookAccessSchema.Type;

export function canAccessPlaybook(access: PlaybookAccess, playbook: unknown): boolean {
  return access === '*' || (Array.isArray(access) && Predicate.isString(playbook) && access.includes(playbook));
}
