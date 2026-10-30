import { Data, Schema } from 'effect';

import type { RejectionBecause } from './rejection-because.ts';

export const UnavailableKindSchema = Schema.Literals([
  'model_not_offered',
  'tool_not_offered',
  'tool_server_failed',
  'tools_unfinished',
  'rebuilding',
  'requests_full',
  'builds_full',
  'dataset_not_ready',
  'model_process_busy',
  'model_process_failed',
  'meter_unavailable',
]);

export type UnavailableKind = typeof UnavailableKindSchema.Type;

export class Unavailable extends Data.TaggedError('unavailable')<{
  readonly detail: string;
  readonly kind?: UnavailableKind;
  readonly because?: RejectionBecause;
  readonly record?: Schema.JsonObject;
}> {}
