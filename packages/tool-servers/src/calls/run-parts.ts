import type { Effect } from 'effect';

import type { CallerContext, ServerMessage } from '../access/caller-context.ts';
import type { CallsEndedBecause } from '../access/tool-server-failed.ts';
import type { CallTally, Timing } from '../bounds/call-bounds.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { ListedTool } from '../bounds/tool-results.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { KeepContent } from './recorded-calls.ts';
import type { ServerSlot } from './server-slot.ts';

export interface OfferedOnServer {
  readonly slot: ServerSlot;
  readonly reference: ToolReference;
  readonly tool: ListedTool;
}

export interface NamedOffer extends OfferedOnServer {
  readonly name: string;
}

export interface ToolCallRequest {
  readonly callId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly room?: number;
}

export interface CallSignals {
  readonly signal: Readonly<AbortSignal>;
  readonly cancelled: Readonly<AbortSignal>;
}

export interface RunToolsParts {
  readonly context: CallerContext;
  readonly slots: readonly ServerSlot[];
  readonly offered: readonly OfferedOnServer[];
  readonly secrets: Secrets;
  readonly keep: KeepContent;
  readonly timing: Timing;
  readonly report: (message: ServerMessage) => void;
  readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}

export interface RunState {
  readonly tally: () => CallTally;
  readonly tallied: (tally: CallTally) => void;
  readonly used: (offer: OfferedOnServer) => void;
  readonly ended: (because: CallsEndedBecause) => void;
  readonly answered: (bytes: number) => void;
}
