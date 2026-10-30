import type { FetchLike } from '@modelcontextprotocol/client';
import type { SettingProblem } from '@on.auto/config';
import { Data } from 'effect';

import type { McpServerSettings, OpenApiServerSettings, StdioServerSettings } from '../settings/server-settings.ts';
import type { ApiOperation, LeftOutOperation } from './api-tools.ts';

interface DescribedApi {
  readonly baseUrl: string;
  readonly operations: readonly ApiOperation[];
}

export interface DescribedApiSettings extends OpenApiServerSettings {
  readonly api: DescribedApi;
}

export type LinkedServerSettings = McpServerSettings | StdioServerSettings | DescribedApiSettings;

export interface ToolServers {
  readonly servers: readonly LinkedServerSettings[];
}

export interface Describing {
  readonly fetch?: FetchLike;
  readonly readMs?: number;
  readonly reportLeftOut: (server: string, leftOut: LeftOutOperation) => void;
}

export class DocumentRefused extends Data.TaggedError('document_refused')<{
  readonly problems: readonly SettingProblem[];
}> {}
