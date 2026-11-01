import type { RecordedContent } from '@on.auto/content';
import { memoryRecordedContent } from '@on.auto/content/testing';
import { documentsReadInProcess } from '@on.auto/documents/testing';
import { Effect, Function } from 'effect';

import type { ServerMessage } from '../access/caller-context.ts';
import { makeToolAccess } from '../call-fetch/access-of-the-call.ts';
import { consentClientWith } from '../consent-testing/consent-fakes.ts';
import type { Describing, ToolServers } from '../openapi/described-api.ts';
import { describedToolServers } from '../openapi/described-servers.ts';
import {
  readToolServerSettings,
  type Environment,
  type ToolServerSettingsContext,
} from '../settings/settings-reading.ts';

type ToolAccessOptions = Parameters<typeof makeToolAccess>[1];

type ToolAccess = ReturnType<typeof makeToolAccess>;

export const testClientInfo: ToolAccessOptions['clientInfo'] = { name: '@on.auto/runtime', version: '0.0.0-test' };

export interface AccessOptions {
  readonly environment?: Environment;
  readonly timing?: ToolAccessOptions['timing'];
  readonly fetch?: ToolAccessOptions['fetch'];
  readonly consent?: ToolAccessOptions['consent'];
  readonly now?: ToolAccessOptions['now'];
  readonly traceMeta?: ToolAccessOptions['traceMeta'];
  readonly connections?: ToolAccessOptions['connections'];
  readonly runtimeSecrets?: ToolAccessOptions['runtimeSecrets'];
  readonly documents?: ToolAccessOptions['documents'] | null;
  readonly providers?: NonNullable<ToolServerSettingsContext['providers']>;
  readonly reportMarkUnlisted?: ToolAccessOptions['reportMarkUnlisted'];
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

function timedBy({ timing, now, traceMeta }: AccessOptions): Pick<ToolAccessOptions, 'timing' | 'now' | 'traceMeta'> {
  return {
    ...(timing === undefined ? {} : { timing }),
    ...(now === undefined ? {} : { now }),
    ...(traceMeta === undefined ? {} : { traceMeta }),
  };
}

function accessOver(settings: ToolServers, options: AccessOptions): ReportingAccess {
  const { fetch, consent = consentClientWith(), connections, runtimeSecrets, documents, reportMarkUnlisted } = options;
  const messages: ServerMessage[] = [];
  const content = memoryRecordedContent();
  const access = makeToolAccess(settings, {
    clientInfo: testClientInfo,
    consent,
    content,
    ...(documents === null ? {} : { documents: documents ?? documentsReadInProcess }),
    reportServerMessage: (message) => {
      messages.push(message);
    },
    ...timedBy(options),
    ...(fetch === undefined ? {} : { fetch }),
    ...(connections === undefined ? {} : { connections }),
    ...(runtimeSecrets === undefined ? {} : { runtimeSecrets }),
    ...(reportMarkUnlisted === undefined ? {} : { reportMarkUnlisted }),
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
