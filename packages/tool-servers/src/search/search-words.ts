import { capitalized, counted, listed, quoted, type Noun } from '@on.auto/operations';

import { inWords, namesListed, toolInWords } from '../names/tool-words.ts';
import { isUnready } from '../org-servers/connection-source.ts';
import { everyPlaybook } from '../settings/server-settings.ts';
import type {
  Found,
  OrgFound,
  OrgSearchAsked,
  OrgSearchedServer,
  SearchAsked,
  SearchedServer,
} from './search-schemas.ts';
import { searchBounds } from './search-terms.ts';

interface Spoken {
  readonly server: SearchedServer;
  readonly named: string;
  readonly user: string;
}

interface Telling {
  readonly terms: string | undefined;
  readonly opening: string;
  readonly among: string;
}

type FoundTools = Found['tools'];

const serverNoun: Noun = { one: 'tool server', other: 'tool servers' };

const toolNoun: Noun = { one: 'tool', other: 'tools' };

interface Adding {
  readonly takesConnections: boolean;
  readonly where: 'playbook' | 'org';
}

type Offered = Pick<OrgFound, 'providers'>;

const withAddConnection = ', with add_connection where your tools include it';

const addedWhere: Readonly<Record<Adding['where'], string>> = {
  playbook: ', or a person adds one to the org as a connection',
  org: `, or a person adds one as a connection${withAddConnection}`,
};

const providerConnected = `, or a person connects a provider this search lists${withAddConnection}`;

function addedOf({ takesConnections, where }: Adding, { providers = [] }: Offered): string {
  if (providers.length > 0) {
    return providerConnected;
  }
  return takesConnections ? addedWhere[where] : '';
}

function untilOneIsSetUp(adding: Adding, offered: Offered): string {
  return `until whoever runs this server sets one up${addedOf(adding, offered)}; the give-tools guide says how.`;
}

function noServer(adding: Adding, offered: Offered): string {
  return `No tool server serves this playbook, so its functions can call no tools ${untilOneIsSetUp(adding, offered)}`;
}

function noServerInOrg(adding: Adding, offered: Offered): string {
  return `No tool server serves this org, so the functions of its playbooks can call no tools ${untilOneIsSetUp(adding, offered)}`;
}

export function unavailableInWords(
  server: Pick<Extract<SearchedServer, { readonly unavailable: string }>, 'unavailable' | 'because'>,
  named: string,
): string {
  if (isUnready(server.because) || server.because === 'scope_lacking') {
    return `${named} cannot be used: ${server.unavailable}.`;
  }
  return server.because === 'key_refused'
    ? `${named} did not accept the key this server gives it, so whoever runs this server can check that key.`
    : `${named} could not be asked for its tools just now.`;
}

function serverInWords({ server, named, user }: Spoken, tools: FoundTools): string {
  if ('unavailable' in server) {
    return unavailableInWords(server, named);
  }
  if (server.tool_count === 0) {
    return `${named} offers no tool ${user} may use.`;
  }
  const offered = `${named} offers ${counted(server.tool_count, toolNoun)}`;
  const listedHere = tools.filter((found) => found.server === server.name).map(({ tool }) => inWords(tool));
  return listedHere.length === 0 ? `${offered}.` : `${offered}: ${namesListed(listedHere)}.`;
}

function foundInWords(tools: FoundTools, terms: string, among: string): string {
  if (tools.length === 0) {
    return `No tool of ${among} matches ${quoted(terms)}.`;
  }
  const verb = tools.length === 1 ? 'matches' : 'match';
  const named = namesListed(tools.map((found) => toolInWords(found)));
  return `${capitalized(counted(tools.length, toolNoun))} of ${among} ${verb} ${quoted(terms)}, best first: ${named}.`;
}

function toolCountOf(server: SearchedServer): number {
  return 'tool_count' in server ? server.tool_count : 0;
}

function tooManyInWords(spoken: readonly Spoken[], tools: FoundTools): readonly string[] {
  const offered = spoken.reduce((total, { server }) => total + toolCountOf(server), 0);
  return tools.length === 0 && offered > searchBounds.found
    ? [`They offer ${counted(offered, toolNoun)} in all, too many to list at once, so search them by terms.`]
    : [];
}

function answerInWords(spoken: readonly Spoken[], tools: FoundTools, { terms, opening, among }: Telling): string {
  if (terms !== undefined) {
    const unavailable = spoken.filter(({ server }) => 'unavailable' in server);
    const said = unavailable.map((each) => serverInWords(each, tools));
    return [foundInWords(tools, terms, among), ...said].join(' ');
  }
  const each = spoken.map((server) => serverInWords(server, tools));
  return [opening, ...tooManyInWords(spoken, tools), ...each].join(' ');
}

function attempted(terms: string | undefined, where: string): string {
  return terms === undefined ? `list the tools of ${where}` : `search the tools of ${where} for ${quoted(terms)}`;
}

function serverOr(server: string | undefined, otherwise: string): string {
  return server === undefined ? otherwise : `the tool server ${quoted(server)}`;
}

const ofThePlaybook = "this playbook's tool servers";

const ofTheOrg = "the tool servers of this org's playbooks";

export const searchTask = "search the tools of the tool servers this playbook's functions may use";

export function searchAttempted({ terms, server }: SearchAsked): string {
  return attempted(terms, serverOr(server, ofThePlaybook));
}

function spokenInThePlaybook(server: SearchedServer): Spoken {
  return { server, named: quoted(server.name), user: 'this playbook' };
}

export function searched(found: Found & Offered, { terms }: SearchAsked, adding: Adding): string {
  const { servers, tools } = found;
  if (servers.length === 0) {
    return noServer(adding, found);
  }
  return answerInWords(
    servers.map((server) => spokenInThePlaybook(server)),
    tools,
    {
      terms,
      opening: `This playbook's functions may use ${counted(servers.length, serverNoun)}.`,
      among: ofThePlaybook,
    },
  );
}

function playbooksInWords(playbooks: readonly string[]): string {
  if (playbooks.includes(everyPlaybook)) {
    return 'every playbook';
  }
  const named = listed(playbooks.map((playbook) => quoted(playbook)));
  return playbooks.length === 0
    ? 'no playbook'
    : `${playbooks.length === 1 ? 'the playbook' : 'the playbooks'} ${named}`;
}

function spokenInTheOrg(server: OrgSearchedServer): Spoken {
  return { server, named: `${quoted(server.name)}, for ${playbooksInWords(server.playbooks)},`, user: 'a function' };
}

export function orgSearchAttempted({ terms, server, playbook }: OrgSearchAsked): string {
  return attempted(terms, serverOr(server, playbook === undefined ? ofTheOrg : ofThePlaybook));
}

export function orgSearched(answer: OrgFound, asked: OrgSearchAsked, adding: Adding): string {
  if (asked.playbook !== undefined) {
    return searched(answer, asked, adding);
  }
  const { servers, tools } = answer;
  if (servers.length === 0) {
    return noServerInOrg(adding, answer);
  }
  return answerInWords(
    servers.map((server) => spokenInTheOrg(server)),
    tools,
    {
      terms: asked.terms,
      opening: `The playbooks of this org may use ${counted(servers.length, serverNoun)}.`,
      among: ofTheOrg,
    },
  );
}
