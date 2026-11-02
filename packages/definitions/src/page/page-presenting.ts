import type { PlaybookAddress } from '@on.auto/operations';
import { Clock, Effect, Result } from 'effect';

import type { Standing } from '../capability/capability.ts';
import type { PresentedPage, Presenting, RunShown, SubjectShown } from '../capability/definition-kinds.ts';
import { viewStandingOf, type KeptViewState, type KeptViews } from '../capability/view-standing.ts';
import { renderClock } from '../template/render-clock.ts';
import { definitionPresentedBy, pageDetailsIn, pageSubjectOf, publishedPageDetails } from './page-details.ts';
import { parsePageDocument } from './page-parsing.ts';
import { latelyShown, resultShown, type ReadMoment, type ViewsShown } from './page-rendering.ts';

const readMoment: Effect.Effect<ReadMoment> = Effect.gen(function* () {
  const now = new Date(yield* Clock.currentTimeMillis).toISOString();
  return { today: now.slice(0, 10), now, clock: yield* renderClock };
});

function documentOf({ source }: PresentedPage) {
  return Result.getOrUndefined(parsePageDocument(source));
}

function subjectLineOf(source: string): number {
  return Result.match(parsePageDocument(source), { onSuccess: ({ ofLine }) => ofLine, onFailure: () => 1 });
}

function pageResultOf(page: PresentedPage, run: RunShown, subject: SubjectShown): Effect.Effect<string | undefined> {
  const template = documentOf(page)?.templates.result;
  return template === undefined
    ? Effect.undefined
    : Effect.map(readMoment, (moment) => resultShown(template, run, subject, moment));
}

function viewsShownOf(page: PresentedPage, kept: KeptViewState | undefined): ViewsShown {
  if (kept?.version !== page.version || kept.phase === 'waiting' || kept.phase === 'rebuilding') {
    return { state: 'building' };
  }
  return kept.phase === 'stalled' ? { state: 'stalled' } : { state: 'live', views: kept.view };
}

function pageLately(views: KeptViews) {
  return (page: PresentedPage, subject: SubjectShown, place: PlaybookAddress): Effect.Effect<string | undefined> => {
    const document = documentOf(page);
    const template = document?.templates.lately;
    if (document?.data === undefined || template === undefined) {
      return Effect.undefined;
    }
    const declared = document.data.views;
    return Effect.all([views.viewOf(place, page.name), readMoment]).pipe(
      Effect.map(([kept, moment]: readonly [KeptViewState | undefined, ReadMoment]) =>
        latelyShown(template, viewsShownOf(page, kept), { declared, subject }, moment),
      ),
    );
  };
}

export function pagePresenting(views: KeptViews): Presenting {
  return {
    subjectOf: pageSubjectOf,
    definitionPresentedBy,
    publishedDetails: publishedPageDetails,
    subjectLineOf,
    resultOf: pageResultOf,
    latelyOf: pageLately(views),
  };
}

export function pageStanding(views: KeptViews): Standing {
  return ({ org, playbook, name, version, status, details }) =>
    status === 'retired' || pageDetailsIn(details)?.data === undefined
      ? Effect.undefined
      : Effect.all([views.viewOf({ org, playbook }, name), views.newestRecordAt({ org, playbook })]).pipe(
          Effect.map(([kept, newestAt]: readonly [KeptViewState | undefined, string | undefined]) =>
            viewStandingOf(version, kept, newestAt),
          ),
        );
}
