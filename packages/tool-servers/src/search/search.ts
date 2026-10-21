import { InvalidInput, PlaybookContext, defineQuery } from '@on.auto/operations';
import { Effect } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import { foundIn } from './found-tools.ts';
import { FoundSchema, SearchInputSchema } from './search-schemas.ts';
import { searchAttempted, searchTask, searched } from './search-words.ts';

export const searchSentences = [
  "Searches the tools of the tool servers this playbook's functions may use, named in a function's tools as server/tool or server/* and called by execute.",
  'Without `terms` it lists the servers and, while they offer at most 100 tools together, every tool; with `terms`, the tools whose names, arguments or descriptions hold them, best first.',
  'Each server is asked at each call, and one that cannot be asked just now says why in place of its tools.',
  '`server` keeps one server, `only` the tools that read or those that may write; introspect describes a tool whole.',
];

export function noServerNamed(server: string, holder: string): InvalidInput {
  const detail = `${holder} has no tool server named ${server}; call search without server to search the ones it has`;
  return new InvalidInput({ detail, issues: [{ detail, pointer: '/server' }] });
}

export function defineSearch(access: Pick<ToolAccess, 'listServers' | 'takesConnections'>) {
  return defineQuery('playbook', {
    name: 'search',
    title: 'Search tools',
    description: searchSentences.join(' '),
    route: { method: 'GET', path: '/tool-servers/search' },
    reachesOutside: true,
    inputSchema: SearchInputSchema,
    outputSchema: FoundSchema,
    reasons: ['invalid_input'],
    handle: Effect.fnUntraced(function* (asked) {
      const servers = yield* access.listServers(yield* PlaybookContext, asked.server);
      if (asked.server !== undefined && servers.length === 0) {
        return yield* noServerNamed(asked.server, 'This playbook');
      }
      return foundIn(servers, asked);
    }),
    plainLanguage: {
      task: searchTask,
      attempt: (asked) => searchAttempted(asked),
      outcome: (answer, asked) =>
        searched(answer, asked, { takesConnections: access.takesConnections, where: 'playbook' }),
    },
  });
}
