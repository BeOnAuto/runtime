import { ToolNotOffered } from '../access/tool-not-offered.ts';
import { ToolServerFailed } from '../access/tool-server-failed.ts';
import type { Secrets } from '../bounds/secrets.ts';
import type { FailureKind, ServerFailure } from '../clients/server-failures.ts';
import type { UnavailableBecause } from '../listing/tool-server.ts';
import type { ServerSettings } from '../settings/server-settings.ts';
import { isUnready } from './connection-source.ts';

export interface Unusable {
  readonly because: UnavailableBecause;
  readonly detail: string;
}

const failedBecause: Readonly<Record<FailureKind, UnavailableBecause>> = {
  unreachable: 'unreachable',
  timed_out: 'unreachable',
  closed: 'unreachable',
  rate_limited: 'rate_limited',
  failing: 'failing',
  forgotten: 'failing',
  refused: 'failing',
  key_refused: 'key_refused',
  too_large: 'failing',
  not_allowed: 'connection_not_allowed',
};

export function serverFailed(
  { settings }: { readonly settings: Pick<ServerSettings, 'name'> },
  { kind, message }: ServerFailure,
  { scrub }: Pick<Secrets, 'scrub'>,
): Unusable {
  const detail =
    kind === 'not_allowed' ? message : `The tool server ${settings.name} could not be used: ${scrub(message)}`;
  return { because: failedBecause[kind], detail };
}

export function refusalOf({ because, detail }: Unusable): ToolNotOffered | ToolServerFailed {
  return isUnready(because) ? new ToolNotOffered({ because, detail }) : new ToolServerFailed({ because, detail });
}
