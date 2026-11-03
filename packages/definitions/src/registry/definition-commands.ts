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

export interface DefinitionPause {
  readonly type: 'pause';
  readonly name: string;
  readonly paused_by: RecordedCaller;
  readonly reason?: string;
}

export interface DefinitionResumption {
  readonly type: 'resume';
  readonly name: string;
}

type DefinitionStandingChange = DefinitionRetirement | DefinitionPause | DefinitionResumption;

export type DefinitionCommandData = DefinitionCreation | DefinitionUpdate | DefinitionStandingChange;

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export type DefinitionCommand = DefinitionCommandData & CommandMetadata;
