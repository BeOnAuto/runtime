import { answerOf, cachedAnswerOf } from '../discovery/cached-answer.ts';
import type { McpServing } from '../mcp/mcp-connection.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { RegisterRoutes } from '../routes.ts';
import { openApiDocumentOf } from './openapi-document.ts';

export interface OpenApiServing extends Pick<McpServing, 'catalog' | 'serverInfo' | 'shelf'> {
  readonly authorizationServer: string | undefined;
}

export const openApiPath = `${versionPrefix}/openapi.json`;

export function openApiDocumentRoutes({
  catalog,
  serverInfo,
  shelf,
  authorizationServer,
}: OpenApiServing): RegisterRoutes {
  const document = cachedAnswerOf(
    JSON.stringify(openApiDocumentOf(catalog, serverInfo, shelf, authorizationServer)),
    'application/json',
  );
  return (routes) => {
    routes.addPublic('GET', openApiPath, (c) => answerOf(c, document));
  };
}
