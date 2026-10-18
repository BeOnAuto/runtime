import type { RouteRegistration } from '@on.auto/operations';

export interface Tag {
  readonly name: string;
  readonly description?: string;
}

const descriptionsOfTags: Readonly<Record<string, string>> = {
  playbooks: 'The playbooks of the org: made, listed, read, renamed and retired',
  models: 'The models this server can call, which a reasoning function names',
  definitions: "A playbook's function and workflow definitions, and the runs they start",
  runs: "A playbook's runs: read, listed, cancelled, their history, and events sent to a waiting run",
  events: 'The events published to a playbook, and its history of events',
  analytics: 'How the runs of a playbook went, counted by day',
  interactions: 'The requests runs wait on, and their answers',
  'tool-servers': 'The tool servers the functions of a playbook may use, and tests of their tools',
  connections:
    "The tool servers people add to the org, which its playbooks share, and the routes of Studio's page that approves them",
  providers: 'The providers a person may connect to the org by name, and whether the caller may add a connection',
  prediction: "A prediction function's datasets and versions, and the routes of the trainer that builds it",
  guides: "The playbook's guides: what its words mean, how each kind of definition is written, and recipes",
};

const resourcesOfOperations: Readonly<Record<string, string>> = {
  answer_interaction: 'interactions',
  activate_version: 'prediction',
  read_build_brief: 'prediction',
  read_build_rows: 'prediction',
  upload_candidate: 'prediction',
  upload_dataset: 'prediction',
};

export const guidesTag = 'guides';

export function tagOf({ name, route }: RouteRegistration): string {
  return resourcesOfOperations[name] ?? route.path.split('/').slice(1, 2).join('');
}

export function tagsNamed(names: readonly string[]): readonly Tag[] {
  return [...new Set(names)].map((name) => {
    const description = descriptionsOfTags[name];
    return description === undefined ? { name } : { name, description };
  });
}
