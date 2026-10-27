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
  scope_lacking: 'scope_lacking',
  broken: 'connection_broken',
  too_large: 'failing',
  not_allowed: 'connection_not_allowed',
};

const saidAsTheyAre: ReadonlySet<FailureKind> = new Set(['not_allowed', 'broken']);

function detailOf(name: string, { kind, message }: ServerFailure, scrub: Secrets['scrub']): string {
  if (saidAsTheyAre.has(kind)) {
    return message;
  }
  return kind === 'scope_lacking' ? scrub(message) : `The tool server ${name} could not be used: ${scrub(message)}`;
}

export function serverFailed(
  { settings }: { readonly settings: Pick<ServerSettings, 'name'> },
  failure: ServerFailure,
  { scrub }: Pick<Secrets, 'scrub'>,
): Unusable {
  return { because: failedBecause[failure.kind], detail: detailOf(settings.name, failure, scrub) };
}

export function refusalOf({ because, detail }: Unusable): ToolNotOffered | ToolServerFailed {
  return isUnready(because) ? new ToolNotOffered({ because, detail }) : new ToolServerFailed({ because, detail });
}
