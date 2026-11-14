import type { RecordedCaller } from '@on.auto/operations';

import type { DefinitionContent } from './definition-events.ts';

export interface DefinitionCreation {
  readonly type: 'create';
  readonly name: string;
  readonly content: DefinitionContent;
  readonly created_by: RecordedCaller;
  readonly definition_id: string;
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

export interface DefinitionRestoration {
  readonly type: 'restore';
  readonly name: string;
  readonly restored_by: RecordedCaller;
}

type DefinitionStandingChange = DefinitionRetirement | DefinitionPause | DefinitionResumption | DefinitionRestoration;

export type DefinitionCommandData = DefinitionCreation | DefinitionUpdate | DefinitionStandingChange;

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export type DefinitionCommand = DefinitionCommandData & CommandMetadata;
