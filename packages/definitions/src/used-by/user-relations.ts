import type { PhrasedDefinition } from '../overview/overview.ts';
import type { CallingStep, UserRelation } from './called-definitions.ts';

export interface DefinitionUser extends PhrasedDefinition {
  readonly relation: UserRelation;
  readonly steps?: readonly CallingStep[];
}

export type CalledStanding = 'active' | 'retired' | 'missing';

export interface DefinitionCalled extends PhrasedDefinition {
  readonly standing: CalledStanding;
  readonly description?: string;
}
