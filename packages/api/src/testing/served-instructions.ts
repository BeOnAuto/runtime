import { allPermissions, type CallerIdentity } from '@on.auto/operations';

import type { DefinitionType, McpEndpoint, RecipeCalls, ServedTools } from '../mcp/instructions.ts';

const managingPlaybooks = ['create_playbook', 'list_playbooks', 'update_playbook', 'retire_playbook'];

const insideAPlaybook = [
  'create_definition',
  'list_definitions',
  'get_definition',
  'update_definition',
  'retire_definition',
  'run_definition',
  'get_run',
  'cancel_run',
  'list_runs',
  'list_playbook_events',
  'publish_event',
  'search',
  'introspect',
  'dry_run',
  'execute',
  'list_interactions',
  'answer_interaction',
  'send_run_event',
  'get_guide',
];

export const queriesInsideAPlaybook = [
  'list_definitions',
  'get_definition',
  'get_run',
  'list_runs',
  'list_playbook_events',
  'search',
  'introspect',
  'dry_run',
  'list_interactions',
  'get_guide',
];

const discovering = ['list_models', 'search'];

const connecting = ['add_connection', 'list_connections', 'remove_connection'];

export const orgEndpoint: ServedTools = {
  orgTools: [...managingPlaybooks, ...discovering, 'get_guide'],
  playbookTools: [],
};

export const playbookEndpoint: ServedTools = { orgTools: [], playbookTools: insideAPlaybook };

export const ownOrg: ServedTools = {
  orgTools: [...managingPlaybooks, ...discovering],
  playbookTools: insideAPlaybook.filter((name) => !discovering.includes(name)),
};

export const signedInAda: CallerIdentity = {
  id: 'person:user_2ada',
  name: 'Ada Lovelace',
  org: 'acme',
  permissions: allPermissions,
  playbooks: '*',
};

export const buildBot: CallerIdentity = { ...signedInAda, id: 'build-bot', name: 'build-bot' };

export const localDeveloper: CallerIdentity = { ...signedInAda, id: 'local', name: 'ada', org: 'local' };

export const definitionTypes: readonly DefinitionType[] = [
  { type: 'reasoning', noun: 'reasoning function', guide: 'reasoning-function' },
  { type: 'interaction', noun: 'interaction function', guide: 'interaction-function' },
  { type: 'computation', noun: 'computation function', guide: 'computation-function' },
  { type: 'recall', noun: 'recall function', guide: 'recall-function' },
  { type: 'prediction', noun: 'prediction function', guide: 'prediction-function' },
  { type: 'workflow', noun: 'workflow', guide: 'workflow' },
];

export const recipes: readonly RecipeCalls[] = [
  {
    name: 'first-playbook',
    calls: [
      'list_playbooks',
      'create_playbook',
      'create_definition',
      'execute',
      'run_definition',
      'publish_event',
      'list_runs',
      'get_run',
    ],
  },
  {
    name: 'remember',
    calls: ['list_definitions', 'create_definition', 'update_definition', 'publish_event', 'run_definition'],
  },
  {
    name: 'give-tools',
    calls: ['search', 'introspect', 'execute', 'create_definition', 'run_definition', 'list_playbook_events'],
  },
  { name: 'schedule', calls: ['list_definitions', 'create_definition', 'update_definition', 'list_runs', 'get_run'] },
];

export function withConnections({ orgTools, playbookTools }: ServedTools): ServedTools {
  return { orgTools: [...orgTools, ...connecting], playbookTools };
}

export const everyEndpoint: readonly (readonly [McpEndpoint, ServedTools])[] = [
  ['org', withConnections(orgEndpoint)],
  ['playbook', playbookEndpoint],
  ['own org', withConnections(ownOrg)],
];
