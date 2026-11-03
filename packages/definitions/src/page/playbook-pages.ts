import { PlaybookReader, PlaybookWriter, type Decider } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { commandMetadata } from '../operations/command-metadata.ts';
import { definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { PageEventSchema, type RecordedPageEvent, type SubjectPage } from './page-facts.ts';
import { carriedPageOf, type CarriedPage } from './pages-saved-as-definitions.ts';
import { playbookSubject, type PlaybookPageSave } from './subject-pages-port.ts';

const playbookPageStream = definitionTypeStreamOf('playbook');

export interface PlaybookPage {
  readonly saves: number;
  readonly page: SubjectPage | undefined;
}

interface PlaybookPageSaving {
  readonly saved: PlaybookPageSave | null;
  readonly carried: string | undefined;
  readonly by: string;
  readonly at: string;
}

const noPlaybookPage: PlaybookPage = { saves: 0, page: undefined };

function evolvedPage({ saves }: PlaybookPage, { data }: RecordedPageEvent): PlaybookPage {
  const version = saves + 1;
  return data.page === null
    ? { saves: version, page: undefined }
    : {
        saves: version,
        page: { version, source: data.page.source, details: data.page.details },
      };
}

function isAsSaved({ saves, page }: PlaybookPage, { saved, carried }: PlaybookPageSaving): boolean {
  const standing = saves === 0 ? carried : page?.source;
  return saved === null ? standing === undefined : standing === saved.source;
}

function pageSavedOf(saved: PlaybookPageSave | null) {
  return saved === null ? null : { source: saved.source, ...saved.content };
}

const playbookPageDecider: Decider<PlaybookPage, PlaybookPageSaving, RecordedPageEvent> = {
  initialState: noPlaybookPage,
  evolve: evolvedPage,
  decide: (saving, standing) =>
    Result.succeed(
      isAsSaved(standing, saving) ? [] : [{ type: 'playbook_page_saved', data: { page: pageSavedOf(saving.saved) } }],
    ),
  context: ({ by, at }) => ({ by, at }),
  eventSchema: PageEventSchema,
};

export const playbookPageIn: Effect.Effect<PlaybookPage, never, PlaybookReader> = PlaybookReader.use((reader) =>
  reader.load(playbookPageStream, playbookPageDecider),
).pipe(Effect.map(({ state }) => state));

function carriedAsItStands(carried: CarriedPage | undefined): SubjectPage | undefined {
  return carried === undefined
    ? undefined
    : { version: carried.version, source: carried.source, details: carried.details };
}

export const playbookPageSaved = Effect.fnUntraced(function* (saved: PlaybookPageSave | null) {
  const metadata = yield* commandMetadata;
  const carried = yield* carriedPageOf(playbookSubject);
  const { state } = yield* (yield* PlaybookWriter).execute(playbookPageStream, playbookPageDecider, {
    saved,
    carried: carried?.source,
    ...metadata,
  });
  return state.saves === 0 ? carriedAsItStands(carried) : state.page;
});
