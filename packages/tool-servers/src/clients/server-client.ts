import type { CallMeta } from '@on.auto/operations';

import type { ListedTool, ServedTool, ToolResult } from '../bounds/tool-results.ts';
import type { Observed } from './observed-requests.ts';

export interface ToolCalling {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly meta: CallMeta;
  readonly signal: Readonly<AbortSignal>;
  readonly timeoutMs: number;
}

export type CallSettled =
  | { readonly result: ToolResult; readonly resultJson: string; readonly observed: Observed }
  | { readonly error: unknown; readonly observed: Observed };

export const unobserved: Observed = { id: null, response: null };

interface ClientListing<Tool extends ServedTool> {
  readonly call: (calling: ToolCalling) => Promise<CallSettled>;
  readonly listTools: (timeoutMs: number) => Promise<readonly Tool[]>;
  readonly closed: Promise<void>;
  readonly end: () => Promise<void>;
}

export type ServedClient = ClientListing<ServedTool>;

export type ServerClient = ClientListing<ListedTool>;
