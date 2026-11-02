import {
  defineCapability,
  functionCategoryLabels,
  functionResourceLabels,
  type Capability,
} from '@on.auto/definitions';
import { callRunOf, longestCallRunMs } from '@on.auto/definitions/tool-blocks';
import type { ToolAccess } from '@on.auto/tool-servers';

import { markCheck } from '../marks/mark-check.ts';
import { describeLookup, parse, summarize } from './definition-reading.ts';
import { lookupType } from './lookup-type.ts';

export interface LookupPorts {
  readonly tools: Pick<ToolAccess, 'callOnce' | 'listServers'>;
}

function callsTools(): boolean {
  return true;
}

export function makeLookupFunctionAdapter({ tools }: LookupPorts): Capability {
  const { singular, plural } = functionResourceLabels.lookup;
  const run = callRunOf({ tools }, { noun: singular, requiredMark: 'reads' });
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
    run: (document, input, context) => run(document, input, context),
    whenCancelled: 'finish',
    longestAnyRunMs: longestCallRunMs,
    reachesOutside: true,
    mayChangeOutside: false,
    callsTools,
  });
}
