export interface ReservedHeaders {
  readonly names: ReadonlySet<string>;
  readonly setBy: string;
}

export type RemoteServerType = 'mcp' | 'openapi';

const headersOfEveryCall: readonly string[] = ['accept', 'content-type', 'content-length', 'host'];

const reservedHeaders: Readonly<Record<RemoteServerType, ReservedHeaders>> = {
  mcp: {
    names: new Set([...headersOfEveryCall, 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']),
    setBy: 'the MCP client',
  },
  openapi: { names: new Set(headersOfEveryCall), setBy: 'the runtime' },
};

export function headersTheRuntimeSets(type: RemoteServerType): ReservedHeaders {
  return reservedHeaders[type];
}
