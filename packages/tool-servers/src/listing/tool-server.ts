import { Schema } from 'effect';

import { serverFailedReasons } from '../access/tool-server-failed.ts';
import type { ToolAnnotations } from '../bounds/tool-results.ts';
import { unreadyReasons } from '../org-servers/connection-source.ts';
import type { ServerType } from '../settings/server-settings.ts';

export const UnavailableBecauseSchema = Schema.Literals([...serverFailedReasons, ...unreadyReasons]);

export type UnavailableBecause = typeof UnavailableBecauseSchema.Type;

export interface ServerTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly input_schema: Schema.JsonObject;
  readonly annotations?: ToolAnnotations;
  readonly answersNoBody?: true;
}

export interface ServerFields {
  readonly name: string;
  readonly type: ServerType;
  readonly record_content: boolean;
  readonly playbooks: readonly string[];
  readonly connection?: string;
  readonly provider: string | null;
}

export interface AvailableServer extends ServerFields {
  readonly tools: readonly ServerTool[];
}

export interface UnavailableServer extends ServerFields {
  readonly unavailable: string;
  readonly because: UnavailableBecause;
}

export type ToolServer = AvailableServer | UnavailableServer;
