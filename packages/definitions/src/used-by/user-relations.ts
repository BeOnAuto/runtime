import type { CallingStep, NamedDefinition, UserRelation } from './called-definitions.ts';

interface CallingUser extends NamedDefinition {
  readonly relation: 'calls';
  readonly steps: readonly CallingStep[];
}

interface NamingUser extends NamedDefinition {
  readonly relation: Exclude<UserRelation, 'calls'>;
}

export type DefinitionUser = CallingUser | NamingUser;
