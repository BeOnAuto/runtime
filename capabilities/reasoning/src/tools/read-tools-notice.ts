import type { RunContext } from '@on.auto/definitions';
import type { Notice, PlaybookAddress } from '@on.auto/operations';
import { listed, mostNoticeCharacters } from '@on.auto/phrasing';
import { onlyReads, type ToolAccess, type ToolServer } from '@on.auto/tool-servers';
import { namesEveryTool, writtenOf, type ToolReference } from '@on.auto/tool-servers/policy';
import { Effect } from 'effect';

import type { ReasoningFunctionDefinitionDocument } from '../definition/reasoning-function-definition.ts';

const readToolsKind = 'tools_only_read';

const opening = 'Its tools are all marked reads: ';

const closing =
  '. Choosing what to search, what to open or which hits to read is not exploring: a reasoning function with no tools chooses, and lookups search and read each choice in a `for`. Keep the tools only if its next search depends on what it just read. Move the reads now, or tell the person what it searches for after a read.';

function namedWithin(written: readonly string[], room: number): string {
  const whole = listed(written);
  if (whole.length <= room) {
    return whole;
  }
  const fitting = written.findLastIndex((_, index) => {
    const named = [...written.slice(0, index), `${String(written.length - index)} more`];
    return listed(named).length <= room;
  });
  return listed([...written.slice(0, fitting), `${String(written.length - fitting)} more`]);
}

export function readToolsNoticeOf(tools: readonly ToolReference[]): Notice {
  const room = mostNoticeCharacters - opening.length - closing.length;
  const written = [...new Set(tools.map((tool) => writtenOf(tool)))];
  return {
    kind: readToolsKind,
    detail: `${opening}${namedWithin(written, room)}${closing}`,
    at: '/tools',
    certainty: 'likely',
  };
}

function readsOn(reference: ToolReference, server: ToolServer | undefined): boolean {
  if (server === undefined || !('tools' in server)) {
    return false;
  }
  if (namesEveryTool(reference)) {
    return server.tools.length > 0 && server.tools.every((tool) => onlyReads(tool));
  }
  const named = server.tools.filter(({ name }) => name === reference.tool);
  return named.length > 0 && named.every((tool) => onlyReads(tool));
}

type SaveListing = Pick<ToolAccess, 'listServersInOrg'>;

type Listed = readonly [string, ToolServer | undefined];

function listedOnce(access: SaveListing, place: PlaybookAddress, server: string): Effect.Effect<Listed> {
  return Effect.map(access.listServersInOrg(place, server), ({ servers }): Listed => [
    server,
    servers.find(({ name }) => name === server),
  ]);
}

function noticesAmong(tools: readonly ToolReference[], found: readonly Listed[]): readonly Notice[] {
  const byName = new Map(found);
  return tools.every((reference) => readsOn(reference, byName.get(reference.server))) ? [readToolsNoticeOf(tools)] : [];
}

export function readToolsNoticesAtSave(
  access: SaveListing,
): (definition: ReasoningFunctionDefinitionDocument, place: PlaybookAddress) => Effect.Effect<readonly Notice[]> {
  return ({ tools }, place) => {
    if (tools.length === 0) {
      return Effect.succeed([]);
    }
    const servers = [...new Set(tools.map(({ server }) => server))];
    return Effect.map(
      Effect.forEach(servers, (server) => listedOnce(access, place, server), { concurrency: 'unbounded' }),
      (found: readonly Listed[]) => noticesAmong(tools, found),
    );
  };
}

interface OfferedMark {
  readonly readOnly: boolean;
}

function askedByTheAgent({ calledBy, trigger }: Pick<RunContext, 'calledBy' | 'trigger'>): boolean {
  return calledBy === undefined && trigger === undefined;
}

export function readToolsNoticesOfARun(
  { tools }: Pick<ReasoningFunctionDefinitionDocument, 'tools'>,
  offered: readonly OfferedMark[],
  run: Pick<RunContext, 'calledBy' | 'trigger'>,
): readonly Notice[] {
  return askedByTheAgent(run) && offered.length > 0 && offered.every(({ readOnly }) => readOnly)
    ? [readToolsNoticeOf(tools)]
    : [];
}
