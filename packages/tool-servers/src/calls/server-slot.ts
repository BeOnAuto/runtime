import { Result } from 'effect';

import type { ServerClient } from '../clients/server-client.ts';
import { failureOf, type ServerFailure } from '../clients/server-failures.ts';
import type { ServerLink } from '../clients/server-links.ts';
import type { LinkedServerSettings } from '../openapi/described-api.ts';

type Restart = 'running' | 'restarted' | 'exited_again';

export interface ServerSlot {
  readonly settings: LinkedServerSettings;
  readonly client: () => ServerClient;
  readonly reopenOnce: () => Promise<boolean>;
  readonly restartIfExited: () => Promise<Restart>;
  readonly release: () => Promise<void>;
}

function serverSlot(link: ServerLink, first: ServerClient): ServerSlot {
  let current = first;
  let exited = false;
  let reopened = false;
  let restarted = false;
  const watched = (client: ServerClient): ServerClient => {
    void client.closed.then(() => {
      exited = exited || current === client;
      return exited;
    });
    return client;
  };
  const renewed = async (): Promise<void> => {
    current = watched(await link.renew(current));
    exited = false;
  };
  watched(first);
  return {
    settings: link.settings,
    client: () => current,
    reopenOnce: async () => {
      if (reopened) {
        return false;
      }
      reopened = true;
      await renewed();
      return true;
    },
    restartIfExited: async () => {
      if (!exited) {
        return 'running';
      }
      if (restarted) {
        return 'exited_again';
      }
      restarted = true;
      await renewed();
      return 'restarted';
    },
    release: () => link.release(),
  };
}

export function takenSlot(link: ServerLink): Promise<Result.Result<ServerSlot, ServerFailure>> {
  return link.take().then(
    (client) => Result.succeed(serverSlot(link, client)),
    (error: unknown) => Result.fail(failureOf(error)),
  );
}
