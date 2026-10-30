import { answerOf, cachedAnswerOf } from '../discovery/cached-answer.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { RegisterRoutes } from '../routes.ts';
import { guideMediaType } from './guide-resources.ts';
import type { Guide, GuideShelf } from './guide-shelf.ts';

export function guidePathOf({ name }: Pick<Guide, 'name'>): string {
  return `${versionPrefix}/guides/${name}`;
}

export function guideRoutes({ everyGuide }: GuideShelf): RegisterRoutes {
  const guides = everyGuide.map((guide) => ({
    path: guidePathOf(guide),
    answer: cachedAnswerOf(guide.text, `${guideMediaType}; charset=utf-8`),
  }));
  return (routes) => {
    for (const { path, answer } of guides) {
      routes.addPublic('GET', path, (c) => answerOf(c, answer));
    }
  };
}
