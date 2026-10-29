import { streamKindOf } from '../reading/presentation.ts';
import type { Presenter } from '../reading/presenter.ts';
import type {
  ChangeKind,
  ChangeNaming,
  ChangeReader,
  NameOfChange,
  PlacedFact,
  ResourceChange,
} from './change-naming.ts';

export interface ChangeCatalog<Fact extends PlacedFact> {
  readonly kinds: readonly [ChangeKind, ...ChangeKind[]];
  readonly streamKinds: readonly string[];
  readonly namedTypes: readonly string[];
  readonly changesOf: (fact: Fact) => readonly ResourceChange[];
  readonly readableBy: (reader: ChangeReader) => (change: ResourceChange) => boolean;
}

function requireOneNamingPerKind(namings: readonly ChangeNaming<never>[]): void {
  const kinds = namings.map(({ streamKind }) => streamKind);
  const repeated = kinds.find((kind, index) => kinds.indexOf(kind) !== index);
  if (repeated !== undefined) {
    throw new Error(`More than one naming names the changes of the stream kind ${repeated}`);
  }
}

function kindsOf(namings: readonly ChangeNaming<never>[]): readonly ChangeKind[] {
  const byName = new Map<string, ChangeKind>();
  for (const kind of namings.flatMap(({ changes }) => changes.kinds)) {
    const known = byName.get(kind.kind);
    if (known !== undefined && known !== kind) {
      throw new Error(`The change kind ${kind.kind} is declared twice, and one declaration alone may give it`);
    }
    byName.set(kind.kind, kind);
  }
  return [...byName.values()];
}

function requireSomeKind(kinds: readonly ChangeKind[]): readonly [ChangeKind, ...ChangeKind[]] {
  const [first, ...others] = kinds;
  if (first === undefined) {
    throw new Error('The changes a client learns of need a naming that names at least one kind of change');
  }
  return [first, ...others];
}

export function changeCatalogOf<Fact extends PlacedFact>(namings: readonly ChangeNaming<Fact>[]): ChangeCatalog<Fact> {
  requireOneNamingPerKind(namings);
  const kinds = requireSomeKind(kindsOf(namings));
  const byKind = new Map(namings.map(({ streamKind, changes }) => [streamKind, changes.named]));
  const byName = new Map(kinds.map((kind) => [kind.kind, kind]));
  return {
    kinds,
    streamKinds: namings.map(({ streamKind }) => streamKind),
    namedTypes: [
      ...new Set(
        namings.flatMap(({ changes }) =>
          Object.entries(changes.named)
            .filter(([, name]: readonly [string, NameOfChange<Fact> | null]) => name !== null)
            .map(([type]: readonly [string, unknown]) => type),
        ),
      ),
    ],
    changesOf: (fact) => {
      const named = byKind.get(streamKindOf(fact.stream));
      const name = named !== undefined && Object.hasOwn(named, fact.type) ? named[fact.type] : undefined;
      return name === undefined || name === null ? [] : name(fact);
    },
    readableBy: (reader) => (change) => byName.get(change.kind)?.readableBy(reader, change) === true,
  };
}

function unnamedTypeOf({ publicNames, changes }: Presenter): string | undefined {
  const presented = Object.keys(publicNames);
  const named = Object.keys(changes.named);
  return [
    ...presented.filter((type) => !named.includes(type)),
    ...named.filter((type) => !presented.includes(type)),
  ].at(0);
}

export function presentedChangeCatalogOf(presenters: readonly Presenter[]): ChangeCatalog<PlacedFact> {
  for (const presenter of presenters) {
    const unnamed = unnamedTypeOf(presenter);
    if (unnamed !== undefined) {
      throw new Error(
        `The presenter of the stream kind ${presenter.streamKind} must say what its fact ${unnamed} changes, and of no fact it does not present`,
      );
    }
  }
  return changeCatalogOf(presenters);
}
