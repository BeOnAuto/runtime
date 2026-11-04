import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
  type SucceededRunsReader,
} from '@on.auto/definitions';
import { callRunOf, longestCallRunMs } from '@on.auto/definitions/tool-blocks';
import type { ToolAccess } from '@on.auto/tool-servers';

import type { LookupFunctionDefinitionDocument } from '../document/lookup-document.ts';
import { markCheck } from '../marks/mark-check.ts';
import { mostPagesReadInARun } from '../runs/runs-read.ts';
import { runsRun } from '../runs/runs-run.ts';
import { describeLookup, parse, summarize } from './definition-reading.ts';
import { lookupType } from './lookup-type.ts';

export interface LookupPorts {
  readonly tools: Pick<ToolAccess, 'callOnce' | 'listServers'>;
  readonly runs: SucceededRunsReader;
  readonly mostPagesRead?: number;
}

function callsTools({ kind }: LookupFunctionDefinitionDocument): boolean {
  return kind === 'call';
}

export function makeLookupFunctionAdapter({
  tools,
  runs,
  mostPagesRead = mostPagesReadInARun,
}: LookupPorts): Capability {
  const { singular, plural } = functionResourceLabels.lookup;
  const callRun = callRunOf({ tools }, { noun: singular, requiredMark: 'reads' });
  const runsRunOf = runsRun({ runs, mostPagesRead });
  return defineCapability({
    type: lookupType,
    title: functionCategoryLabels.lookup,
    guide: { name: 'lookup-function' },
    noun: { one: singular, other: plural },
    describeOutput: describeLookup,
    mediaType: 'text/markdown',
    parse,
    check: markCheck(tools),
    summarize,
    run: (document, input, context) =>
      document.kind === 'call' ? callRun(document, input, context) : runsRunOf(document, input, context),
    whenCancelled: 'finish',
    longestAnyRunMs: longestCallRunMs,
    reachesOutside: true,
    mayChangeOutside: false,
    callsTools,
  });
}
