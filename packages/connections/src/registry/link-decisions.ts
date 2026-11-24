import type { Rejection } from '@on.auto/operations';
import type { Result } from 'effect';

import { decideApproval, decideGiving } from './connecting-decisions.ts';
import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { decideFinish, decideStart } from './consent-decisions.ts';
import { decideClientGiving } from './oauth-client-decisions.ts';
import type { Registry } from './registry.ts';

type Decision = Result.Result<readonly ConnectionEvent[], Rejection<'not_found' | 'conflict' | 'invalid_input'>>;

type ThroughTheLink = Extract<
  ConnectionCommand,
  { readonly type: 'approve' | 'give' | 'give_client' | 'start' | 'finish' }
>;

const kindsThroughTheLink: ReadonlySet<string> = new Set(['approve', 'give', 'give_client', 'start', 'finish']);

export function isThroughTheLink(command: ConnectionCommand): command is ThroughTheLink {
  return kindsThroughTheLink.has(command.type);
}

export function decidedThroughTheLink(command: ThroughTheLink, registry: Registry): Decision {
  if (command.type === 'approve') {
    return decideApproval(command, registry);
  }
  if (command.type === 'give') {
    return decideGiving(command, registry);
  }
  if (command.type === 'give_client') {
    return decideClientGiving(command, registry);
  }
  return command.type === 'start' ? decideStart(command, registry) : decideFinish(command, registry);
}
