import { Effect } from 'effect';

import type {
  ConnectionEvents,
  ConnectionReporting,
  StandingAsked,
  TriggerStanding,
} from '../triggers/connection-ports.ts';

export interface AskedConnections extends ConnectionEvents {
  readonly asked: () => readonly string[];
}

const listening: TriggerStanding = {
  speed: 'instant',
  listening: true,
  notListeningBecause: null,
  needsReconnecting: false,
};

export function connectionsReporting(
  reportings: Readonly<Record<string, ConnectionReporting>>,
  standingOf: (asked: StandingAsked) => TriggerStanding = () => listening,
): AskedConnections {
  const asked: string[] = [];
  return {
    reportingOf: (playbook, connection) =>
      Effect.sync(() => {
        asked.push(`${playbook.playbook}/${connection}`);
        return Object.hasOwn(reportings, connection) ? reportings[connection] : undefined;
      }),
    standingOf: (_playbook, standingAsked) => Effect.sync(() => standingOf(standingAsked)),
    asked: () => asked,
  };
}
