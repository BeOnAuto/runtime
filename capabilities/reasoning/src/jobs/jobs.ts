import type { OutputShapeName } from '@on.auto/definitions';
import type { CallEnded } from '@on.auto/tool-servers';
import type { ToolReply } from '@on.auto/tool-servers/policy';
import type { Effect, Schema } from 'effect';

import type { ModelFailure } from '../failure/model-failure.ts';
import type { ModelRequest, TextOutput } from '../model/model-request.ts';
import type { ModelResult } from '../model/model-result.ts';

interface JsonOutputDocument {
  readonly type: 'json';
  readonly schema: Schema.JsonObject;
  readonly shape?: OutputShapeName;
}

export type OutputDocument = TextOutput | JsonOutputDocument;

export type ModelCallRequest = Omit<ModelRequest, 'output'> & { readonly output: OutputDocument };

export interface ModelCallJob {
  readonly request: ModelCallRequest;
}

export interface ToolCallJob {
  readonly callId: string;
  readonly tool: string;
  readonly server: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly room?: number;
}

export interface ToolCallAnswer {
  readonly ended: CallEnded;
  readonly reply: ToolReply;
}

export interface PerformJob {
  readonly modelCall: (job: ModelCallJob) => Effect.Effect<ModelResult, ModelFailure>;
  readonly toolCall: (job: ToolCallJob) => Effect.Effect<ToolCallAnswer>;
}
