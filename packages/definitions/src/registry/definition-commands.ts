import type { RecordedCaller } from '@on.auto/operations';

import type { DefinitionContent } from './definition-events.ts';

export interface DefinitionCreation {
  readonly type: 'create';
  readonly name: string;
  readonly content: DefinitionContent;
  readonly created_by: RecordedCaller;
}

export interface DefinitionUpdate {
  readonly type: 'update';
  readonly name: string;
  readonly content: DefinitionContent;
}

export interface DefinitionRetirement {
  readonly type: 'retire';
  readonly name: string;
}

export type DefinitionCommandData = DefinitionCreation | DefinitionUpdate | DefinitionRetirement;

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export type DefinitionCommand = DefinitionCommandData & CommandMetadata;
