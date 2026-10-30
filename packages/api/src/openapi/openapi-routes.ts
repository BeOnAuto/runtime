import { answerOf, cachedAnswerOf } from '../discovery/cached-answer.ts';
import type { McpServing } from '../mcp/mcp-connection.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { RegisterRoutes } from '../routes.ts';
import { openApiDocumentOf } from './openapi-document.ts';

export interface OpenApiServing extends Pick<McpServing, 'catalog' | 'serverInfo' | 'shelf'> {
  readonly identityIssuer: string;
}

export const openApiPath = `${versionPrefix}/openapi.json`;

export function openApiDocumentRoutes({ catalog, serverInfo, shelf, identityIssuer }: OpenApiServing): RegisterRoutes {
  const document = cachedAnswerOf(
    JSON.stringify(openApiDocumentOf(catalog, serverInfo, shelf, identityIssuer)),
    'application/json',
  );
  return (routes) => {
    routes.addPublic('GET', openApiPath, (c) => answerOf(c, document));
  };
}
