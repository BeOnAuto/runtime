import type { PhrasedDefinition } from '../overview/overview.ts';
import type { CallingStep, UserRelation } from './called-definitions.ts';

interface CallingUser extends PhrasedDefinition {
  readonly relation: 'calls';
  readonly steps: readonly CallingStep[];
}

interface NamingUser extends PhrasedDefinition {
  readonly relation: Exclude<UserRelation, 'calls'>;
}

export type DefinitionUser = CallingUser | NamingUser;

export type CalledStanding = 'active' | 'retired' | 'missing';

export interface DefinitionCalled extends PhrasedDefinition {
  readonly standing: CalledStanding;
  readonly description?: string;
}
