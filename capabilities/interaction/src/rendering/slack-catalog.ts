import { standardComponentDefinitions } from '@json-render/chat';
import { toJSONSchema } from 'zod';

export interface CatalogEntry {
  readonly description: string;
  readonly takesChildren: boolean;
  readonly props: unknown;
}

export const slackCatalog: Record<string, CatalogEntry> = {};

for (const [name, definition] of Object.entries(standardComponentDefinitions)) {
  slackCatalog[name] = {
    description: definition.description,
    takesChildren: definition.slots.length > 0,
    props: toJSONSchema(definition.props, { io: 'input', unrepresentable: 'any' }),
  };
}
