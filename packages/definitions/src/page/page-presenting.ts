import type { PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, Option, Result, type Schema } from 'effect';

import { viewStandingOf, type KeptViewState, type KeptViews } from '../capability/view-standing.ts';
import { renderClock } from '../template/render-clock.ts';
import type { SubjectPage } from './page-facts.ts';
import { pageIn } from './page-key.ts';
import {
  latelyShown,
  resultShown,
  type ReadMoment,
  type RunShown,
  type SubjectShown,
  type ViewsShown,
} from './page-rendering.ts';
import type { PageOf, PageWrittenIn } from './subject-pages-port.ts';

export type PageWritten = PageWrittenIn | 'carried';

export interface PlacedPage {
  readonly page: SubjectPage;
  readonly written: PageWritten;
  readonly of: PageOf;
  readonly view: string;
  readonly place: PlaybookAddress;
  readonly subject: SubjectShown;
}

const readMoment: Effect.Effect<ReadMoment> = Effect.gen(function* () {
  const now = new Date(yield* Clock.currentTimeMillis).toISOString();
  return { today: now.slice(0, 10), now, clock: yield* renderClock };
});

function documentOf({ page, of, written }: Pick<PlacedPage, 'page' | 'of' | 'written'>) {
  const readAs = written === 'carried' ? (of === 'playbook' ? 'playbook' : 'mapping') : written;
  return Option.getOrUndefined(Result.getOrElse(pageIn(page.source, readAs), Option.none));
}

export function pageResultOf(
  placed: Pick<PlacedPage, 'page' | 'of' | 'written' | 'subject'>,
  run: RunShown,
): Effect.Effect<string | undefined> {
  const template = documentOf(placed)?.templates.result;
  return template === undefined
    ? Effect.undefined
    : Effect.map(readMoment, (moment) => resultShown(template, run, placed.subject, moment));
}

function viewsShownOf(kept: KeptViewState | undefined): ViewsShown {
  if (kept === undefined || kept.phase === 'waiting' || kept.phase === 'rebuilding') {
    return { state: 'building' };
  }
  return kept.phase === 'stalled' ? { state: 'stalled' } : { state: 'live', views: kept.view };
}

export function pageLatelyOf(views: KeptViews, placed: PlacedPage): Effect.Effect<string | undefined> {
  const document = documentOf(placed);
  const template = document?.templates.lately;
  if (document?.data === undefined || template === undefined) {
    return Effect.undefined;
  }
  const declared = document.data.views;
  return Effect.all([views.viewOf(placed.place, placed.view), readMoment]).pipe(
    Effect.map(([kept, moment]: readonly [KeptViewState | undefined, ReadMoment]) =>
      latelyShown(template, viewsShownOf(kept), { declared, subject: placed.subject }, moment),
    ),
  );
}

export function pageStandingOf(views: KeptViews, placed: PlacedPage): Effect.Effect<Schema.JsonObject | undefined> {
  return placed.page.details.data === undefined
    ? Effect.undefined
    : Effect.all([views.viewOf(placed.place, placed.view), views.newestRecordAt(placed.place)]).pipe(
        Effect.map(([kept, newestAt]: readonly [KeptViewState | undefined, string | undefined]) =>
          viewStandingOf(kept?.version ?? placed.page.version, kept, newestAt),
        ),
      );
}
