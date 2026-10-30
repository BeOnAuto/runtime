import { Data } from 'effect';

export const serverFailedReasons = ['failing', 'rate_limited', 'unreachable', 'key_refused', 'scope_lacking'] as const;

export type ServerFailedBecause = (typeof serverFailedReasons)[number];

export type CallsEndedBecause = Exclude<ServerFailedBecause, 'unreachable' | 'key_refused' | 'scope_lacking'>;

export class ToolServerFailed extends Data.TaggedError('tool_server_failed')<{
  readonly because: ServerFailedBecause;
  readonly detail: string;
}> {}
