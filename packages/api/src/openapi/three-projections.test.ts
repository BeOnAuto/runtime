import { makeCatalog, type RouteRegistration } from '@on.auto/operations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { routeTableOf } from '../operations/route-table.ts';
import { blobOperations } from '../testing/blob-operations.ts';
import { listenOnLoopback, type Listening } from '../testing/listening.ts';
import { withMcpSession } from '../testing/mcp-clients.ts';
import { listNotesOfTheOrg, notebookOperations } from '../testing/notebook.ts';
import { operationsIn, type DocumentedOperation } from '../testing/openapi/openapi-document.ts';
import { acmeAdmin, operationServer, type OperationServer } from '../testing/operation-server.ts';
import { operationToolsIn, type ListedTool } from '../testing/tool-listing.ts';

const operations = [...notebookOperations, listNotesOfTheOrg, ...blobOperations];

const { operations: registrations } = makeCatalog(operations);

let server: OperationServer;
let listening: Listening;
let documented: readonly DocumentedOperation[];
let tools: Readonly<Record<RouteRegistration['scope'], readonly ListedTool[]>>;

function listingOn(path: string): Promise<readonly ListedTool[]> {
  return withMcpSession(
    'current revision',
    { url: `${listening.origin}${path}`, headers: { authorization: `Bearer ${acmeAdmin.key}` } },
    async (session) => operationToolsIn(await session.listTools()),
  );
}

beforeAll(async () => {
  server = await operationServer({ operations });
  listening = await listenOnLoopback(server.handler);
  const document: unknown = await (await fetch(`${listening.origin}/v1/openapi.json`)).json();
  documented = operationsIn(document);
  tools = {
    org: await listingOn('/orgs/acme/mcp'),
    playbook: await listingOn('/orgs/acme/playbooks/alpha/mcp'),
  };
});

afterAll(async () => {
  await listening.close();
  await server.runtime.dispose();
});

function documentedOf({ scope, name }: RouteRegistration): readonly DocumentedOperation[] {
  const id = scope === 'org' && name === 'list_notes' ? 'list_notes_in_org' : name;
  return documented.filter(({ operation }) => operation.operationId === id);
}

function routesOf(registration: RouteRegistration): readonly string[] {
  return routeTableOf(makeCatalog(operations))
    .filter((entry) => entry.registration === registration)
    .map(({ registration: { route }, path }) => `${route.method} ${path}`);
}

function servedRouteOf({ method, path }: DocumentedOperation): string {
  return `${method.toUpperCase()} /v1${path.replaceAll(/\{(\w+)\}/gu, ':$1')}`;
}

function namedIn({ scope, name }: RouteRegistration): readonly (string | undefined)[] {
  return tools[scope].filter((listed) => listed.name === name).map(({ description }) => description);
}

const servedAsTools = registrations.filter((registration) => registration.servedOverHttpAlone === undefined);

const servedOverHttpOnly = registrations.filter((registration) => registration.servedOverHttpAlone !== undefined);

describe('the three projections of the catalog', () => {
  it.each(registrations)(
    'agree on $scope operation $name: one route, one operation, one description',
    (registration) => {
      const described = documentedOf(registration);

      expect(described.map(({ operation }) => operation.description)).toEqual([registration.description]);
      expect(routesOf(registration)).toEqual(described.map((operation) => servedRouteOf(operation)));
    },
  );

  it.each(servedAsTools)('agree on $scope operation $name: one tool, with the same description', (registration) => {
    expect(namedIn(registration)).toEqual([registration.description]);
  });

  it.each(servedOverHttpOnly)(
    'agree on $scope operation $name: no tool, since HTTP alone serves it',
    (registration) => {
      expect(namedIn(registration)).toEqual([]);
    },
  );

  it('leaves out of the document no operation but the guides, which the catalog does not hold', () => {
    expect(documented.length - registrations.length).toBe(1);
    expect(documented.at(-1)?.operation.operationId).toBe('get_guide');
  });
});
