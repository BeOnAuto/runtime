import { eventMetadataOf } from './event-metadata.ts';
import type { KeptContent, PresentedFact, PresentedPart, Presenter } from './presenter.ts';
import type { EventMetadata, PublicEvent } from './public-event.ts';
import type { RecordedFact } from './recorded-read.ts';
import { shownData, type EventView } from './shown-data.ts';

export interface Showing {
  readonly streamPrefix: string;
  readonly content: KeptContent;
  readonly view: EventView;
}

export interface Presentation {
  readonly present: (recorded: RecordedFact, showing: Showing) => readonly PublicEvent[];
  readonly publicTypes: readonly string[];
  readonly storedTypesOf: (publicType: string) => readonly string[];
}

export function streamKindOf(stream: string): string {
  const end = stream.indexOf('/');
  return end === -1 ? stream : stream.slice(0, end);
}

interface PublicName {
  readonly stored: string;
  readonly name: string;
}

function requireOnePresenterPerKind(presenters: readonly Presenter[]): void {
  const kinds = presenters.map(({ streamKind }) => streamKind);
  const repeated = kinds.find((kind, index) => kinds.indexOf(kind) !== index);
  if (repeated !== undefined) {
    throw new Error(`More than one presenter presents the stream kind ${repeated}`);
  }
}

interface Presenting {
  readonly presenter: Presenter;
  readonly presented: ReadonlySet<string>;
}

function presentingOf(presenter: Presenter): Presenting {
  const presented = Object.entries(presenter.publicNames)
    .filter(([, names]: readonly [string, readonly string[]]) => names.length > 0)
    .map(([stored]: readonly [string, readonly string[]]) => stored);
  return { presenter, presented: new Set(presented) };
}

export const stepIdSeparator = '_';

function partIdOf(id: string, number: number): string {
  return number === 0 ? id : `${id}${stepIdSeparator}${number}`;
}

function rowOf(recorded: RecordedFact, metadata: EventMetadata, view: EventView) {
  const causationOf = (part: PresentedPart): EventMetadata => ({
    ...metadata,
    causation_id: partIdOf(recorded.id, part.causedBy),
  });
  return ({ type, summary, data, part }: PresentedFact): PublicEvent => ({
    id: part === undefined ? recorded.id : partIdOf(recorded.id, part.number),
    type,
    summary,
    data: shownData(data, view),
    metadata: part === undefined ? metadata : causationOf(part),
  });
}

function rowsOf(presenter: Presenter, recorded: RecordedFact, showing: Showing): readonly PublicEvent[] {
  const row = rowOf(recorded, eventMetadataOf(recorded, showing.streamPrefix), showing.view);
  return presenter.present(recorded, showing.content).map((fact) => row(fact));
}

export function presentationOf(presenters: readonly Presenter[]): Presentation {
  requireOnePresenterPerKind(presenters);
  const byKind = new Map(presenters.map((presenter) => [presenter.streamKind, presentingOf(presenter)]));
  const named = presenters
    .flatMap(({ publicNames }) => Object.entries(publicNames))
    .flatMap(([stored, names]: readonly [string, readonly string[]]): readonly PublicName[] =>
      names.map((name) => ({ stored, name })),
    );
  return {
    present: (recorded, showing) => {
      const presenting = byKind.get(streamKindOf(recorded.stream));
      return presenting !== undefined && presenting.presented.has(recorded.type)
        ? rowsOf(presenting.presenter, recorded, showing)
        : [];
    },
    publicTypes: [...new Set(named.map(({ name }) => name))],
    storedTypesOf: (publicType) => [
      ...new Set(named.filter(({ name }) => name === publicType).map(({ stored }) => stored)),
    ],
  };
}
