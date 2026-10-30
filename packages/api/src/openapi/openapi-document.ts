import type { Catalog } from '@on.auto/operations';

import type { GuideShelf } from '../guides/guide-shelf.ts';
import { serverTitle, type ServerInfo } from '../mcp/mcp-connection.ts';
import { versionPrefix } from '../operations/route-table.ts';
import { jsonSchemaDialect } from '../tools/tool-schema.ts';
import { componentsOf } from './document-components.ts';
import { documentDescription } from './document-description.ts';
import { documentPathsOf } from './document-paths.ts';
import type { OpenApiObject } from './problem-responses.ts';

const openApiVersion = '3.1.1';

export function openApiDocumentOf(
  catalog: Catalog,
  { version }: ServerInfo,
  shelf: GuideShelf,
  identityIssuer: string,
): OpenApiObject {
  const { paths, tags, problems } = documentPathsOf(catalog, shelf);
  return {
    openapi: openApiVersion,
    jsonSchemaDialect,
    info: { title: serverTitle, version, description: documentDescription },
    servers: [{ url: versionPrefix }],
    tags,
    paths,
    components: componentsOf(problems, identityIssuer),
  };
}
