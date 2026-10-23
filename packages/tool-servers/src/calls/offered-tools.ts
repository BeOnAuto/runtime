import type { Schema } from 'effect';

import { cutToDescriptionBound } from '../bounds/call-bounds.ts';
import { isReadOnly, type ToolAnnotations } from '../bounds/tool-results.ts';
import { scrubbedSchema } from '../listing/shown-tools.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { CallReply } from './call-replies.ts';
import type {
  CallSignals,
  NamedOffer,
  OfferedOnServer,
  RunState,
  RunToolsParts,
  ToolCallRequest,
} from './run-parts.ts';
import { caller, sending, type ToolSending } from './tool-caller.ts';

export interface OfferedTool extends ToolSending {
  readonly name: string;
  readonly reference: ToolReference;
  readonly server: Pick<OfferedOnServer['slot']['settings'], 'type' | 'connection'>;
  readonly description: string;
  readonly inputSchema: Schema.JsonObject;
  readonly annotations: ToolAnnotations | undefined;
  readonly readOnly: boolean;
  readonly call: (request: ToolCallRequest, signals: CallSignals) => Promise<CallReply>;
}

export function offeredToolOf(parts: RunToolsParts, state: RunState, tool: NamedOffer): OfferedTool {
  const { start, send } = sending(parts, tool);
  return {
    name: tool.name,
    reference: tool.reference,
    server: { type: tool.slot.settings.type, connection: tool.slot.settings.connection },
    description: cutToDescriptionBound(parts.secrets.scrub(tool.tool.description ?? '')),
    inputSchema: scrubbedSchema(tool.tool.inputSchema, parts.secrets.scrub),
    annotations: tool.tool.annotations,
    readOnly: isReadOnly(tool.tool.annotations),
    start,
    send,
    call: caller(parts, state, tool),
  };
}
