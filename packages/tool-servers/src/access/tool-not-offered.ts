import { Data } from 'effect';

import type { UnreadyBecause } from '../org-servers/connection-source.ts';

export type NotOfferedBecause = 'tool_server_not_configured' | 'tool_not_allowed' | 'tool_not_listed' | UnreadyBecause;

export class ToolNotOffered extends Data.TaggedError('tool_not_offered')<{
  readonly because: NotOfferedBecause;
  readonly detail: string;
}> {}
