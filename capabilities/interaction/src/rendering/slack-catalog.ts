import { standardComponentDefinitions } from '@json-render/chat';
import { z, toJSONSchema } from 'zod';

export interface CatalogEntry {
  readonly description: string;
  readonly takesChildren: boolean;
  readonly props: unknown;
}

const { LinkButton } = standardComponentDefinitions;

const AnswerButton = {
  description:
    'Button that sets parts of the answer when it is clicked. A function that takes no answer cannot have one.',
  slots: [],
  props: z.object({
    label: z.string().min(1),
    style: z.enum(['primary', 'danger']).optional(),
    once: z.boolean().optional(),
    sets: z.array(z.object({ at: z.string(), value: z.json() })).min(1),
  }),
};

const writableDefinitions = {
  ...standardComponentDefinitions,
  Button: AnswerButton,
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
