import { Effect, Layer } from 'effect';

import { PlaybookRegistry, type PlaybookAddress, type PlaybookStatus } from '../index.ts';

function holds(playbooks: readonly PlaybookAddress[], { org, playbook }: PlaybookAddress): boolean {
  return playbooks.some((known) => known.org === org && known.playbook === playbook);
}

export function memoryPlaybookRegistry(
  active: readonly PlaybookAddress[],
  retired: readonly PlaybookAddress[] = [],
): Layer.Layer<PlaybookRegistry> {
  const statusOf = (address: PlaybookAddress): PlaybookStatus => {
    if (holds(active, address)) {
      return 'active';
    }
    return holds(retired, address) ? 'retired' : 'unknown';
  };
  return Layer.succeed(
    PlaybookRegistry,
    PlaybookRegistry.of({ status: (address) => Effect.succeed(statusOf(address)) }),
  );
}
