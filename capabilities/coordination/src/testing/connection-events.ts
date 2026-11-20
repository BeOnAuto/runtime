import { Effect } from 'effect';

import type { ConnectionEvents, ConnectionReporting } from '../triggers/connection-triggers.ts';

export interface AskedConnections extends ConnectionEvents {
  readonly asked: () => readonly string[];
}

export function connectionsReporting(reportings: Readonly<Record<string, ConnectionReporting>>): AskedConnections {
  const asked: string[] = [];
  return {
    reportingOf: (playbook, connection) =>
      Effect.sync(() => {
        asked.push(`${playbook.playbook}/${connection}`);
        return Object.hasOwn(reportings, connection) ? reportings[connection] : undefined;
      }),
    asked: () => asked,
  };
}
