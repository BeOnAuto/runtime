import { catalogPathOf, makeCatalog, type RouteRegistration } from '@on.auto/operations';
import { buildSchema, type GraphQLSchema } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { httpAloneOperations } from '../testing/http-alone-operations.ts';
import { listNotesOfTheOrg, notebookOperations } from '../testing/notebook.ts';
import { operationsIn, type DocumentedOperation } from '../testing/openapi/openapi-document.ts';
import { operationServer, type OperationServer } from '../testing/operation-server.ts';

const operations = [...notebookOperations, listNotesOfTheOrg, ...httpAloneOperations];

const { operations: registrations } = makeCatalog(operations);

const readsByGet = registrations.filter(({ kind, route }) => kind === 'query' && route.method === 'GET');

const notReads = registrations.filter((registration) => !readsByGet.includes(registration));

let server: OperationServer;
let documented: readonly DocumentedOperation[];
let queried: GraphQLSchema;

function fetched(path: string): Promise<Response> {
  return server.handler.fetch(new Request(`http://localhost${path}`));
}

beforeAll(async () => {
  server = await operationServer({ operations });
  documented = operationsIn(await (await fetched('/v1/openapi.json')).json());
  queried = buildSchema(await (await fetched('/v1/schema.graphql')).text());
});

afterAll(async () => {
  await server.runtime.dispose();
});

function rootFieldOf(registration: RouteRegistration) {
  const described = documented.find(
    ({ path, method }) => path === catalogPathOf(registration) && method.toUpperCase() === registration.route.method,
  );
  return queried.getQueryType()?.getFields()[String(described?.operation.operationId)];
}

describe('the query schema, a fourth projection of the catalog', () => {
  it.each(readsByGet)(
    'has $scope operation $name, a read by GET, as a root field named and described as documented',
    (registration) => {
      expect(rootFieldOf(registration)?.description).toBe(registration.description);
    },
  );

  it.each(notReads)('has no root field for $scope operation $name, which is no read by GET', (registration) => {
    expect(rootFieldOf(registration)).toBeUndefined();
  });

  it('has no root field but the reads by GET', () => {
    expect(queried.getQueryType()?.astNode?.fields).toHaveLength(readsByGet.length);
  });
});
