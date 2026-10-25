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

export const headersOpeningMetadataServices: ReadonlySet<string> = new Set([
  'metadata',
  'metadata-flavor',
  'x-google-metadata-request',
  'x-aws-ec2-metadata-token',
  'x-aws-ec2-metadata-token-ttl-seconds',
]);

export function headersTheRuntimeSets(type: RemoteServerType): ReservedHeaders {
  return reservedHeaders[type];
}

export const opensAMetadataService =
  "A header that opens a cloud's instance metadata service, which no tool server is sent";

export function reservedHeaderWordsOf(type: RemoteServerType, header: string): string | undefined {
  const lowered = header.toLowerCase();
  if (headersOpeningMetadataServices.has(lowered)) {
    return opensAMetadataService;
  }
  const reserved = reservedHeaders[type];
  return reserved.names.has(lowered) ? `A header ${reserved.setBy} sets itself` : undefined;
}
