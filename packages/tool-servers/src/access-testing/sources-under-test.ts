import { fakeConnections, type FakeConnections } from '../testing/fake-connections.ts';
import { describedAccess, type AccessOptions, type ReportingAccess } from '../testing/reporting-access.ts';
import type { ServedUnderTest } from './servers-under-test.ts';

export const behaviourConnection = '0199e7c1-5b3a-7d2e-9f40-6a1b2c3d4e5f';

type Entry = Readonly<Record<string, unknown>>;

export type SourcedEntry = Pick<ServedUnderTest, 'type' | 'entry' | 'bare' | 'credential'>;

export interface SourceUnderTest {
  readonly kind: string;
  readonly recorded: Readonly<Record<string, unknown>>;
  readonly accessTo: (served: SourcedEntry, options: AccessOptions) => Promise<ReportingAccess>;
}

export const throughTheFile: SourceUnderTest = {
  kind: 'the settings file',
  recorded: {},
  accessTo: ({ entry }, options) => describedAccess({ graph: entry }, options),
};

export function connectedAs(id: string, entry: Entry, { environment = {} }: AccessOptions): FakeConnections {
  const connections = fakeConnections();
  connections.connect('acme', { id, name: 'graph', entry, environment });
  return connections;
}

export const throughAConnection: SourceUnderTest = {
  kind: 'a connection',
  recorded: { connection_id: behaviourConnection },
  accessTo: ({ entry }, options) =>
    describedAccess({}, { ...options, connections: connectedAs(behaviourConnection, entry, options) }),
};
