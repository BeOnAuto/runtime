import { standardComponentDefinitions } from '@json-render/chat';
import { z, toJSONSchema } from 'zod';

export interface CatalogEntry {
  readonly description: string;
  readonly takesChildren: boolean;
  readonly props: unknown;
}

const { LinkButton } = standardComponentDefinitions;

const writableDefinitions = {
  ...standardComponentDefinitions,
  LinkButton: {
    ...LinkButton,
    props: LinkButton.props.extend({ style: z.enum(['primary', 'danger']).optional() }),
  },
};

export const slackCatalog: Record<string, CatalogEntry> = {};

for (const [name, definition] of Object.entries(writableDefinitions)) {
  slackCatalog[name] = {
    description: definition.description,
    takesChildren: definition.slots.length > 0,
    props: toJSONSchema(definition.props, { io: 'input', unrepresentable: 'any' }),
  };
}
