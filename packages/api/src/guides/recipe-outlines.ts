import type { Recipe } from './guide-shelf.ts';

export type RecipeOutline = Omit<Recipe, 'text'>;

export const outlines: readonly RecipeOutline[] = [
  {
    name: 'first-playbook',
    title: 'Create your first playbook',
    description: 'Creates a playbook with a first reasoning function, and runs it once the person has agreed to it.',
    arguments: [],
    formatGuide: 'reasoning-function',
    calls: ['list_playbooks', 'create_playbook', 'create_definition', 'query_connection', 'run_definition'],
    request: () => 'Create my first playbook.',
  },
  {
    name: 'connect-a-service',
    title: 'Connect a service',
    description:
      'Connects a service the team uses to Auto, asking for the access the playbook needs to run and to be set up there, in one approval where the provider offers it, sets the service up once the person agrees, and says what it can do.',
    arguments: [
      { name: 'service', description: 'The service to connect, such as Slack or Google Drive', required: true },
    ],
    calls: [
      'search',
      'introspect',
      'add_connection',
      'list_connections',
      'reconnect_connection',
      'query_connection',
      'execute_connection',
    ],
    request: ({ service }) => `Connect ${String(service)} to Auto for my team, then tell me what it can do.`,
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
    calls: [
      'search',
      'introspect',
      'query_connection',
      'execute_connection',
      'create_definition',
      'run_definition',
      'list_playbook_events',
    ],
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
    calls: [
      'list_definitions',
      'create_definition',
      'update_definition',
      'list_runs',
      'get_run',
      'list_playbook_events',
    ],
    request: ({ workflow, when }) => `Run the workflow ${String(workflow)} ${String(when)}.`,
  },
  {
    name: 'keep',
    title: 'Keep something for later',
    description:
      "Keeps what the person wants kept as the output of a run, and reads it back with a lookup of that definition's runs.",
    arguments: [
      {
        name: 'what',
        description: "What to keep, in the person's words, such as who approves a budget",
        required: true,
      },
    ],
    formatGuide: 'lookup-function',
    calls: ['list_definitions', 'create_definition', 'run_definition'],
    request: ({ what }) => `Keep ${String(what)} for later.`,
  },
];
