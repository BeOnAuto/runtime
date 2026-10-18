import type { RecordedContent } from '@on.auto/operations';
import { memoryRecordedContent } from '@on.auto/operations/testing';
import { Effect } from 'effect';

import type { ServerMessage } from '../access/caller-context.ts';
import { makeToolAccess, type ToolAccess, type ToolAccessOptions } from '../access/tool-access.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import { ignored } from '../clients/ignored.ts';
import type { Describing, ToolServers } from '../openapi/described-api.ts';
import { describedToolServers } from '../openapi/described-servers.ts';
import { readToolServerSettings, type Environment } from '../settings/settings-reading.ts';

export const testClientInfo: ToolAccessOptions['clientInfo'] = { name: '@on.auto/runtime', version: '0.0.0-test' };

export interface AccessOptions {
  readonly environment?: Environment;
  readonly timing?: Timing;
  readonly fetch?: ToolAccessOptions['fetch'];
  readonly traceMeta?: ToolAccessOptions['traceMeta'];
  readonly connections?: ToolAccessOptions['connections'];
}

export interface ReportingAccess {
  readonly access: ToolAccess;
  readonly content: RecordedContent;
  readonly messages: () => readonly ServerMessage[];
}

function servers(
  written: Readonly<Record<string, unknown>>,
  { environment = {}, fetch }: AccessOptions,
  describing: Describing,
) {
  return readToolServerSettings({ ...environment, TOOL_SERVERS: JSON.stringify(written) }, { modelProviders: [] }).pipe(
    Effect.flatMap((settings) =>
      describedToolServers(settings, { ...describing, ...(fetch === undefined ? {} : { fetch }) }),
    ),
  );
}

function accessOver(settings: ToolServers, { timing, fetch, traceMeta, connections }: AccessOptions): ReportingAccess {
  const messages: ServerMessage[] = [];
  const content = memoryRecordedContent();
  const access = makeToolAccess(settings, {
    clientInfo: testClientInfo,
    content,
    reportServerMessage: (message) => {
      messages.push(message);
    },
    ...(timing === undefined ? {} : { timing }),
    ...(fetch === undefined ? {} : { fetch }),
    ...(traceMeta === undefined ? {} : { traceMeta }),
    ...(connections === undefined ? {} : { connections }),
  });
  return { access, content, messages: () => [...messages] };
}

export function reportingAccess(
  written: Readonly<Record<string, unknown>>,
  options: AccessOptions = {},
): ReportingAccess {
  return accessOver(Effect.runSync(servers(written, options, { reportLeftOut: ignored })), options);
}

export async function describedAccess(
  written: Readonly<Record<string, unknown>>,
  options: AccessOptions = {},
): Promise<ReportingAccess> {
  return accessOver(await Effect.runPromise(servers(written, options, { reportLeftOut: ignored })), options);
}

export const noToolServers: ToolAccess = makeToolAccess(
  { servers: [] },
  { clientInfo: testClientInfo, content: memoryRecordedContent(), reportServerMessage: ignored },
);
