import type { Effect, Schema } from 'effect';

import { cutToDescriptionBound, mostRequestBytesTo } from '../bounds/call-bounds.ts';
import { onlyReads, type ToolAnnotations } from '../bounds/tool-results.ts';
import { scrubbedSchema } from '../listing/shown-tools.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { toolInWords } from '../names/tool-words.ts';
import { plannedAssets, type AssetsNotSent, type AssetsPlanned } from '../sent-assets/planned-assets.ts';
import type { CallReply } from './call-replies.ts';
import type {
  CallSignals,
  NamedOffer,
  OfferedOnServer,
  RunState,
  RunToolsParts,
  ToolCallRequest,
} from './run-parts.ts';
import { caller, sending, type SentAssets, type ToolSending } from './tool-caller.ts';

export interface OfferedTool extends ToolSending {
  readonly name: string;
  readonly reference: ToolReference;
  readonly server: Pick<OfferedOnServer['slot']['settings'], 'type' | 'connection' | 'handles_money'>;
  readonly description: string;
  readonly inputSchema: Schema.JsonObject;
  readonly annotations: ToolAnnotations | undefined;
  readonly readOnly: boolean;
  readonly mostBytes: number;
  readonly planned: (input: Readonly<Record<string, unknown>>) => Effect.Effect<AssetsPlanned, AssetsNotSent>;
  readonly call: (request: ToolCallRequest, signals: CallSignals, assets?: SentAssets) => Promise<CallReply>;
}

export function offeredToolOf(parts: RunToolsParts, state: RunState, tool: NamedOffer): OfferedTool {
  const { start, send } = sending(parts, tool);
  const mostBytes = mostRequestBytesTo(tool.slot.settings, parts.mostRequestBytes);
  return {
    name: tool.name,
    reference: tool.reference,
    server: {
      type: tool.slot.settings.type,
      connection: tool.slot.settings.connection,
      ...(tool.slot.settings.handles_money === true ? { handles_money: true } : {}),
    },
    description: cutToDescriptionBound(parts.secrets.scrub(tool.tool.description ?? '')),
    inputSchema: scrubbedSchema(tool.tool.inputSchema, parts.secrets.scrub),
    annotations: tool.tool.annotations,
    readOnly: onlyReads(tool.tool),
    mostBytes,
    planned: (input) =>
      plannedAssets(input, {
        holding: parts.assets,
        playbook: { org: parts.context.org, playbook: parts.context.playbook },
        inputSchema: tool.tool.inputSchema,
        tool: toolInWords(tool.reference),
        mostBytes,
      }),
    start,
    send,
    call: caller(parts, state, tool),
  };
}
