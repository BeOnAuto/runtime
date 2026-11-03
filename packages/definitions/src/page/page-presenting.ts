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

function momentAt(now: string) {
  return Effect.map(renderClock, (clock): ReadMoment => ({ today: now.slice(0, 10), now, clock }));
}

const readMoment: Effect.Effect<ReadMoment> = Effect.flatMap(Clock.currentTimeMillis, (millis) =>
  momentAt(new Date(millis).toISOString()),
);

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
  if (kept.phase === 'stalled' || kept.phase === 'out_of_reach') {
    return { state: kept.phase };
  }
  return { state: 'live', views: kept.view };
}

interface PageViewsRead {
  readonly lately?: string;
  readonly standing?: Schema.JsonObject;
}

interface ViewsAsRead {
  readonly kept: KeptViewState | undefined;
  readonly newestAt: string | undefined;
  readonly moment: ReadMoment;
}

function latelyOver(placed: PlacedPage, { kept, moment }: ViewsAsRead): PageViewsRead {
  const document = documentOf(placed);
  const template = document?.templates.lately;
  if (document?.data === undefined || template === undefined) {
    return {};
  }
  const context = { declared: document.data.views, subject: placed.subject };
  return { lately: latelyShown(template, viewsShownOf(kept), context, moment) };
}

function standingOver(placed: PlacedPage, { kept, newestAt }: ViewsAsRead): PageViewsRead {
  return placed.page.details.data === undefined
    ? {}
    : { standing: viewStandingOf(kept?.version ?? placed.page.version, kept, newestAt) };
}

export const pageViewsOf = Effect.fnUntraced(function* (views: KeptViews, placed: PlacedPage) {
  const read: ViewsAsRead = {
    kept: yield* views.viewOf(placed.place, placed.view),
    newestAt: yield* views.newestRecordAt(placed.place),
    moment: yield* readMoment,
  };
  const shown: PageViewsRead = { ...latelyOver(placed, read), ...standingOver(placed, read) };
  return shown;
});

function momentOfTheRun(kept: KeptViewState | undefined): Effect.Effect<ReadMoment> {
  return kept?.checkpointAt === undefined || kept.checkpointAt === null ? readMoment : momentAt(kept.checkpointAt);
}

export const pageAsOfRun = Effect.fnUntraced(function* (views: KeptViews, placed: PlacedPage, run: string) {
  const document = documentOf(placed);
  const template = document?.templates.lately;
  if (document?.data === undefined || template === undefined) {
    return {};
  }
  const kept = yield* views.viewAsOfRun(placed.place, placed.view, run);
  const moment = yield* momentOfTheRun(kept);
  const context = { declared: document.data.views, subject: placed.subject };
  return {
    lately: latelyShown(template, viewsShownOf(kept), context, moment),
    standing: viewStandingOf(kept?.version ?? placed.page.version, kept, yield* views.newestRecordAt(placed.place)),
  };
});
