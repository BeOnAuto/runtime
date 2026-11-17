import type { GuideVariables } from '@on.auto/definitions';
import { changedOnlyByWhoeverRunsTheServer, sizeInWords } from '@on.auto/phrasing';
import { toolBounds, type ToolAccess } from '@on.auto/tool-servers';

const asThePageHasIt: Pick<ToolAccess, 'mostRequestBytes'> = { mostRequestBytes: toolBounds.requestBytes };

export function guideVariablesOf({ mostRequestBytes } = asThePageHasIt): GuideVariables {
  return {
    'lookup.most_call_arguments': {
      value: sizeInWords(mostRequestBytes),
      default: sizeInWords(asThePageHasIt.mostRequestBytes),
    },
    'lookup.bounds_changed_by': {
      value: changedOnlyByWhoeverRunsTheServer,
      default: changedOnlyByWhoeverRunsTheServer,
    },
  };
}
