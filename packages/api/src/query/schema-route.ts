import { answerOf, cachedAnswerOf } from '../discovery/cached-answer.ts';
import { versionPrefix } from '../operations/route-table.ts';
import type { Routes } from '../routes.ts';

export const queryPath = `${versionPrefix}/orgs/:org/query`;

export const querySchemaPath = `${versionPrefix}/schema.graphql`;

export function schemaServed(routes: Routes, text: string): void {
  const schema = cachedAnswerOf(text, 'text/plain; charset=utf-8');
  routes.addPublic('GET', querySchemaPath, (c) => answerOf(c, schema));
}
