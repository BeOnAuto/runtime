import type { PageDetails } from './page-details.ts';
import type { PageDefinitionDocument } from './page-document.ts';

export function pageDetailsOf({ data }: Pick<PageDefinitionDocument, 'data'>): PageDetails {
  return data === undefined
    ? {}
    : {
        data: {
          views: data.views,
          language: 'typescript',
          fold: data.fold,
          foldLine: data.foldLine,
          filters: data.filters,
        },
      };
}
