import type { RecordedContent } from '@on.auto/operations';
import { memoryRecordedContent } from '@on.auto/operations/testing';
import { Effect, Function } from 'effect';

import type { ServerMessage } from '../access/caller-context.ts';
import { makeToolAccess, type ToolAccess, type ToolAccessOptions } from '../access/tool-access.ts';
import type { Timing } from '../bounds/call-bounds.ts';
import { consentClientWith } from '../consent-testing/consent-fakes.ts';
import type { Describing, ToolServers } from '../openapi/described-api.ts';
import { describedToolServers } from '../openapi/described-servers.ts';
import {
  readToolServerSettings,
  type Environment,
  type ToolServerSettingsContext,
} from '../settings/settings-reading.ts';

export const testClientInfo: ToolAccessOptions['clientInfo'] = { name: '@on.auto/runtime', version: '0.0.0-test' };

export interface AccessOptions {
  readonly environment?: Environment;
  readonly timing?: Timing;
  readonly fetch?: ToolAccessOptions['fetch'];
  readonly consent?: ToolAccessOptions['consent'];
  readonly now?: ToolAccessOptions['now'];
  readonly traceMeta?: ToolAccessOptions['traceMeta'];
  readonly connections?: ToolAccessOptions['connections'];
  readonly runtimeSecrets?: ToolAccessOptions['runtimeSecrets'];
  readonly providers?: NonNullable<ToolServerSettingsContext['providers']>;
}

export interface ReportingAccess {
  readonly access: ToolAccess;
  readonly content: RecordedContent;
  readonly messages: () => readonly ServerMessage[];
}

function servers(
  written: Readonly<Record<string, unknown>>,
  { environment = {}, fetch, providers }: AccessOptions,
  describing: Describing,
) {
  return readToolServerSettings(
    { ...environment, TOOL_SERVERS: JSON.stringify(written) },
    { modelProviders: [], ...(providers === undefined ? {} : { providers }) },
  ).pipe(
    Effect.flatMap((settings) =>
      describedToolServers(settings, { ...describing, ...(fetch === undefined ? {} : { fetch }) }),
    ),
  );
}

function accessOver(
  settings: ToolServers,
  { timing, fetch, consent = consentClientWith(), now, traceMeta, connections, runtimeSecrets }: AccessOptions,
): ReportingAccess {
  const messages: ServerMessage[] = [];
  const content = memoryRecordedContent();
  const access = makeToolAccess(settings, {
    clientInfo: testClientInfo,
    consent,
    content,
    reportServerMessage: (message) => {
      messages.push(message);
    },
    ...(timing === undefined ? {} : { timing }),
    ...(fetch === undefined ? {} : { fetch }),
    ...(now === undefined ? {} : { now }),
    ...(traceMeta === undefined ? {} : { traceMeta }),
    ...(connections === undefined ? {} : { connections }),
    ...(runtimeSecrets === undefined ? {} : { runtimeSecrets }),
  });
  return { access, content, messages: () => [...messages] };
}

export function reportingAccess(
  written: Readonly<Record<string, unknown>>,
  options: AccessOptions = {},
): ReportingAccess {
  return accessOver(Effect.runSync(servers(written, options, { reportLeftOut: Function.constVoid })), options);
}

export async function describedAccess(
  written: Readonly<Record<string, unknown>>,
  options: AccessOptions = {},
): Promise<ReportingAccess> {
  return accessOver(await Effect.runPromise(servers(written, options, { reportLeftOut: Function.constVoid })), options);
}

export const noToolServers: ToolAccess = makeToolAccess(
  { servers: [] },
  {
    clientInfo: testClientInfo,
    consent: consentClientWith(),
    content: memoryRecordedContent(),
    reportServerMessage: Function.constVoid,
  },
);
