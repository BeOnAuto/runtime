import type { RecordedCaller } from '@on.auto/operations';

export interface PlaybookCreation {
  readonly type: 'create';
  readonly playbook: string;
  readonly name: string;
  readonly description: string;
  readonly created_by: RecordedCaller;
}

export interface PlaybookUpdate {
  readonly type: 'update';
  readonly playbook: string;
  readonly name: string;
  readonly description: string;
}

export interface PlaybookRetirement {
  readonly type: 'retire';
  readonly playbook: string;
}

export type PlaybookCommandData = PlaybookCreation | PlaybookUpdate | PlaybookRetirement;

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export type PlaybookCommand = PlaybookCommandData & CommandMetadata;
