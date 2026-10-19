import {
  Caller,
  OrgContext,
  canAccessPlaybook,
  defineQuery,
  type NotFound,
  type OrgReader,
  type PlaybookAccess,
} from '@on.auto/operations';
import { Effect } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import type { ToolServer } from '../listing/tool-server.ts';
import { everyPlaybook } from '../settings/server-settings.ts';
import { offersNoProvider, providersOf, type ProviderOffering } from './found-providers.ts';
import { foundIn, searchedServer } from './found-tools.ts';
import { OrgFoundSchema, OrgSearchInputSchema, type OrgSearchAsked, type OrgSearchedServer } from './search-schemas.ts';
import { orgSearchAttempted, orgSearched, searchTask } from './search-words.ts';
import { noServerNamed, searchSentences } from './search.ts';

const description = [
  ...searchSentences,
  'Without `playbook` it searches the tool servers of the whole org, naming the playbooks each serves.',
  '`providers` lists what a person may connect that no server serves yet.',
].join(' ');

export type PlaybookLookup = (playbook: string) => Effect.Effect<unknown, NotFound, OrgReader>;

function playbooksShownTo(access: PlaybookAccess, playbooks: readonly string[]): readonly string[] {
  return playbooks.filter((playbook) => playbook === everyPlaybook || canAccessPlaybook(access, playbook));
}

function withServedPlaybooks(server: ToolServer, asked: OrgSearchAsked, access: PlaybookAccess): OrgSearchedServer {
  return { ...searchedServer(server, asked), playbooks: playbooksShownTo(access, server.playbooks) };
}

export function defineSearchInOrg(
  tools: Pick<ToolAccess, 'listServersInOrg' | 'takesConnections'>,
  lookUpPlaybook: PlaybookLookup,
  offering: ProviderOffering = offersNoProvider,
) {
  return defineQuery('org', {
    name: 'search',
    title: 'Search tools',
    description,
    route: { method: 'GET', path: '/tool-servers/search' },
    permittedBy: ['org:read', 'playbook:read'],
    reachesOutside: true,
    inputSchema: OrgSearchInputSchema,
    outputSchema: OrgFoundSchema,
    reasons: ['invalid_input', 'not_found'],
    handle: Effect.fnUntraced(function* (asked) {
      const { playbook, server } = asked;
      if (playbook !== undefined) {
        yield* lookUpPlaybook(playbook);
      }
      const { org } = yield* OrgContext;
      const caller = yield* Caller;
      const listing = yield* tools.listServersInOrg({ org, playbook }, server);
      const { servers } = listing;
      if (server !== undefined && servers.length === 0) {
        return yield* noServerNamed(server, playbook === undefined ? 'This org' : 'This playbook');
      }
      return {
        ...foundIn(servers, asked),
        servers: servers.map((listed) => withServedPlaybooks(listed, asked, caller.playbooks)),
        ...providersOf(offering(caller), listing, asked),
      };
    }),
    plainLanguage: {
      task: searchTask,
      attempt: (asked) => orgSearchAttempted(asked),
      outcome: (answer, asked) =>
        orgSearched(answer, asked, { takesConnections: tools.takesConnections, where: 'org' }),
    },
  });
}
