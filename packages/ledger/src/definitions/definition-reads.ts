import { addressedStreamOf, type RunIdInAnOrg } from '@on.auto/operations';
import type { HeldName, NameInAPlaybook, NamesOfAKind, StreamInAPlaybook } from '@on.auto/operations/definition-names';

export interface DefinitionStream {
  readonly stream: string;
  readonly version: number;
  readonly playbookKey: string;
}

export interface DefinitionStreamRead {
  readonly stream: string;
  readonly version: number;
  readonly placed_in: string | null;
}

export function placedStreamsOf(read: readonly DefinitionStreamRead[]): readonly DefinitionStream[] {
  return read.flatMap(({ stream, version, placed_in: placedIn }) => {
    const named = addressedStreamOf(stream);
    const playbookKey = named !== undefined && named.scope === 'playbook' ? named.prefix : placedIn;
    return playbookKey === null ? [] : [{ stream, version, playbookKey }];
  });
}

export interface DefinitionStreamsStore {
  readonly definitionStreams: (definitionType: string) => Promise<readonly DefinitionStream[]>;
}

interface OrgStream {
  readonly org: string;
  readonly version: number;
}

export interface OrgStreamsStore {
  readonly orgStreams: (name: string) => Promise<readonly OrgStream[]>;
}

export interface DefinitionNamesStore {
  readonly holderOfName: (named: NameInAPlaybook) => Promise<HeldName | undefined>;
  readonly nameHeldBy: (definitionKey: string) => Promise<HeldName | undefined>;
  readonly namesHeldIn: (kind: NamesOfAKind) => Promise<readonly HeldName[]>;
  readonly holdersOfName: (named: Omit<NameInAPlaybook, 'definitionType'>) => Promise<readonly HeldName[]>;
  readonly definitionsIn: (playbookKey: string) => Promise<readonly string[]>;
  readonly holderOfStream: (named: StreamInAPlaybook) => Promise<string | undefined>;
}

export interface RunIdsStore {
  readonly holderOfRunId: (claimed: RunIdInAnOrg) => Promise<string | undefined>;
}

export interface LookupTablesStore extends DefinitionNamesStore, RunIdsStore {}
