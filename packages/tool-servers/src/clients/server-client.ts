import type { ListedTool, ToolResult } from '../bounds/tool-results.ts';
import type { Observed } from './observed-requests.ts';

interface ToolCalling {
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly meta: Readonly<Record<string, string>>;
  readonly signal: Readonly<AbortSignal>;
  readonly timeoutMs: number;
}

export type CallSettled =
  | { readonly result: ToolResult; readonly resultJson: string; readonly observed: Observed }
  | { readonly error: unknown; readonly observed: Observed };

export interface ServerClient {
  readonly call: (calling: ToolCalling) => Promise<CallSettled>;
  readonly listTools: (timeoutMs: number) => Promise<readonly ListedTool[]>;
  readonly closed: Promise<void>;
  readonly end: () => Promise<void>;
}
