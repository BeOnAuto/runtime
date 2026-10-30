import { Unavailable, type Remedies } from '@on.auto/operations';

import type { ToolsNotOpened } from '../access/caller-context.ts';
import { cutToFailureBound } from '../bounds/call-bounds.ts';
import type { UnavailableServer } from '../listing/tool-server.ts';
import { refusalOf } from '../org-servers/server-refusals.ts';

export function unavailableOf({
  _tag: kind,
  because,
  detail,
}: Pick<ToolsNotOpened, '_tag' | 'because' | 'detail'>): Unavailable {
  return new Unavailable({ detail: cutToFailureBound(detail), kind, because });
}

export function unavailableServerOf({
  because,
  unavailable,
}: Pick<UnavailableServer, 'because' | 'unavailable'>): Unavailable {
  return unavailableOf(refusalOf({ because, detail: unavailable }));
}

export const toolRemedies: Remedies = {
  tool_server_not_configured:
    'This can be put right on your side: search shows the tool servers this playbook may use, so naming one of those can work.',
  tool_not_allowed:
    'This can be put right on your side: search shows the tools this playbook may use, which whoever runs the server allows, so naming one of those can work.',
  tool_not_listed:
    'This can be put right on your side: search shows the tools each tool server has, so naming one of those can work.',
};
