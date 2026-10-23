import type { Guide, Recipe } from '@on.auto/api';
import { shippedFileIn, type ShippedFiles } from '@on.auto/operations';

import { recipesFolder } from './guide-files.ts';

type RecipeOutline = Omit<Recipe, 'text'>;

const outlines: readonly RecipeOutline[] = [
  {
    name: 'first-playbook',
    title: 'Create your first playbook',
    description: 'Creates a playbook with a first reasoning function, and runs it once the person has agreed to it.',
    arguments: [],
    formatGuide: 'reasoning-function',
    calls: ['list_playbooks', 'create_playbook', 'create_definition', 'execute', 'run_definition'],
    request: () => 'Create my first playbook.',
  },
  {
    name: 'remember',
    title: 'Make the playbook remember something',
    description:
      "Keeps what the playbook's runs answered or its events recorded in a recall function, so that the playbook can tell it later.",
    arguments: [
      {
        name: 'what',
        description: "What the playbook should remember, in the person's words, such as what it posted today",
        required: true,
      },
    ],
    formatGuide: 'recall-function',
    calls: ['list_definitions', 'create_definition', 'update_definition', 'publish_event', 'run_definition'],
    request: ({ what }) => `Make the playbook remember ${String(what)}.`,
  },
  {
    name: 'give-tools',
    title: 'Give the playbook tools',
    description: 'Gives a reasoning function the tools of a tool server the playbook may use.',
    arguments: [
      {
        name: 'server',
        description: 'The tool server whose tools to give, as search names it',
        required: false,
      },
    ],
    formatGuide: 'reasoning-function',
    calls: ['search', 'introspect', 'execute', 'create_definition', 'run_definition', 'list_playbook_events'],
    request: ({ server }) =>
      server === undefined ? 'Give the playbook tools.' : `Give the playbook the tools of the tool server ${server}.`,
  },
  {
    name: 'schedule',
    title: 'Run a workflow on a schedule',
    description: 'Starts a workflow on a schedule or on an event, and reads how its runs went.',
    arguments: [
      { name: 'workflow', description: 'The name of the workflow to run', required: true },
      {
        name: 'when',
        description: "When to run it, in the person's words, such as every weekday at 9:00",
        required: true,
      },
    ],
    formatGuide: 'workflow',
    calls: ['list_definitions', 'create_definition', 'update_definition', 'list_runs', 'get_run'],
    request: ({ workflow, when }) => `Run the workflow ${String(workflow)} ${String(when)}.`,
  },
];

interface Insertion {
  readonly after: string;
  readonly words: string;
}

const interactionGuide = 'interaction-function';

const whereInteractionIsServed: Readonly<Record<string, Insertion>> = {
  'give-tools': {
    after: 'and which of them it needs.',
    words: [
      ' When the playbook only needs what a tool answers, with nothing to reason about, write an interaction function that calls the tool instead: it answers at once with what the tool answered and spends no model call, and the interaction-function guide says how to write it from the answer execute gave.',
      ' When the playbook should send a person a message through a tool and take their answer, write an interaction function instead: the interaction-function guide says how it names the tool it sends through and the tool it reads replies with, each called the same way.',
    ].join(''),
  },
  'first-playbook': {
    after: 'give it tools with the give-tools recipe',
    words: ', send someone a message through a tool and take their answer with an interaction function',
  },
};

async function textOf(
  shippedFiles: ShippedFiles,
  { name }: RecipeOutline,
  carried: ReadonlySet<string>,
): Promise<string> {
  const text = await shippedFiles.text(shippedFileIn(recipesFolder, `${name}.md`));
  const insertion = carried.has(interactionGuide) ? whereInteractionIsServed[name] : undefined;
  return insertion === undefined ? text : text.replace(insertion.after, `${insertion.after}${insertion.words}`);
}

export function recipesFor(shippedFiles: ShippedFiles, guides: readonly Guide[]): Promise<readonly Recipe[]> {
  const carried = new Set(guides.map(({ name }) => name));
  return Promise.all(
    outlines
      .filter(({ formatGuide }) => carried.has(formatGuide))
      .map(async (outline) => Object.assign({ text: await textOf(shippedFiles, outline, carried) }, outline)),
  );
}
