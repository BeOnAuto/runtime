import { openedAndClosed, type OpensASocket, type SocketEnded } from '@on.auto/providers';
import { Effect, Option } from 'effect';

import type { AppCredentialOpening, SocketChecks } from '../page/given-checks.ts';
import type { ValueChecked } from '../page/tested-keys.ts';

function hostsOf(host: string | undefined, { destination }: AppCredentialOpening): readonly string[] {
  const opened = Option.flatMap(Option.fromNullishOr(destination.open), ({ url }) =>
    Option.fromNullishOr(URL.parse(url)?.hostname),
  );
  return Option.toArray(Option.orElse(Option.fromNullishOr(host), () => opened));
}

function checkedAs(opening: AppCredentialOpening) {
  return ({ end, host }: Pick<SocketEnded, 'end' | 'host'>): Effect.Effect<ValueChecked> => {
    if (end === 'refused') {
      return Effect.succeed({ kind: 'refused' });
    }
    const hosts = hostsOf(host, opening);
    return Effect.as(
      Effect.logWarning(
        `An app credential given for a connection was not checked with its service: its socket ended ${end}`,
      ).pipe(Effect.annotateLogs({ hosts: hosts.join(' ') })),
      { kind: 'unreached', hosts },
    );
  };
}

const taken: ValueChecked = { kind: 'taken' };

export function socketChecksOver(opens: OpensASocket): SocketChecks {
  return {
    openedOnce: (opening) => {
      const { value, ...declared } = opening;
      return openedAndClosed(opens, { ...declared, credential: value }).pipe(
        Effect.as(taken),
        Effect.catch(checkedAs(opening)),
      );
    },
  };
}
