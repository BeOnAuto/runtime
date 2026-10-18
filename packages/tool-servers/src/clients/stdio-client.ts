import { Redacted } from 'effect';

import type { StdioServerSettings } from '../settings/server-settings.ts';
import {
  boundedReport,
  errorsNoLongerReported,
  openingClient,
  serverClientOver,
  type ClientInfo,
  type OutputReport,
} from './mcp-client.ts';
import type { ServerClient } from './server-client.ts';
import { StdioProcessTransport } from './stdio-transport.ts';

export interface StdioOpening {
  readonly clientInfo: ClientInfo;
  readonly timeoutMs: number;
  readonly output: OutputReport;
}

function environmentOf({ env }: StdioServerSettings): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...env].map(([name, value]: readonly [string, Redacted.Redacted]) => [name, Redacted.value(value)]),
  );
}

export async function openStdio(settings: StdioServerSettings, opening: StdioOpening): Promise<ServerClient> {
  const sdk = openingClient(
    opening.clientInfo,
    settings.request_id,
    boundedReport(opening.output, errorsNoLongerReported),
  );
  const transport = new StdioProcessTransport(
    { command: settings.command, args: settings.args, env: environmentOf(settings) },
    sdk.observations,
    opening.output,
  );
  try {
    await sdk.client.connect(transport, { timeout: opening.timeoutMs });
  } catch (failure) {
    await transport.close();
    throw failure;
  }
  return serverClientOver(sdk.client, sdk.observations, sdk.closed, () => sdk.client.close());
}
