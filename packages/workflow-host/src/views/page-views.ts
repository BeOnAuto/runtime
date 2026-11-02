import {
  pageDefinitionType,
  pageDetailsIn,
  pageViewsKeyOf,
  shapedViewsSchemaOf,
  type StrippedForms,
} from '@on.auto/definitions';

import type { KeptAlong } from '../projector/projector-settings.ts';
import { runnableDetailsOf } from './view-details.ts';

function pageViewDetailsOf(details: unknown, stripped?: StrippedForms): unknown {
  const data = pageDetailsIn(details)?.data;
  if (data === undefined) {
    return details;
  }
  const { language, fold, foldLine, filters, views } = data;
  const viewDetails = { language, fold, foldLine, filters, initial: {}, schema: shapedViewsSchemaOf(views) };
  return runnableDetailsOf(viewDetails, stripped);
}

export const pageViewsKept: KeptAlong = {
  definitionType: pageDefinitionType,
  keptOf: pageViewDetailsOf,
  keyOf: pageViewsKeyOf,
};
