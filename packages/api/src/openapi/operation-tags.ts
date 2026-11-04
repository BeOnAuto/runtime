import type { RouteRegistration } from '@on.auto/operations';

export interface Tag {
  readonly name: string;
  readonly description?: string;
}

const descriptionsOfTags: Readonly<Record<string, string>> = {
  playbooks: 'The playbooks of the org: made, listed, read, renamed and retired',
  activity:
    "What the playbooks of the org did that a person may want to see, the requests that wait on an answer, the broken definitions, what is new and the open comments, the organization's own among them, and what each caller has seen of it",
  models: 'The models this server can call, which a reasoning function names',
  voice:
    'The voice model this server transcribes a recording with, so a person speaks a comment in Studio rather than typing it',
  definitions: "A playbook's function and workflow definitions, and the runs they start",
  runs: "A playbook's runs: read, listed, cancelled, their history, and events sent to a waiting run",
  events: 'The events published to a playbook, and its history of events',
  analytics: 'How the runs of a playbook went, counted by day',
  interactions: 'The requests runs wait on, and their answers',
  comments:
    'What people say in Studio about the things of a playbook or of the organization, each at the address of what it is about and where on it the comment was dropped, until it is resolved',
  'tool-servers': 'The tool servers the functions of a playbook may use, and tests of their tools',
  connections:
    "The tool servers people add to the org, which its playbooks share, and the routes of Studio's page that approves them",
  assets:
    "The images and audio a playbook's generation functions made, each read by its id with an address to its bytes signed as it is read",
  providers: 'The providers a person may connect to the org by name, and whether the caller may add a connection',
  license:
    'The license of the runtime, activated with the key Studio gives, by which each new action is admitted against the account of an org at Auto',
  content: 'The bytes a playbook keeps by their digest, served at an address the runtime signs for a browser to follow',
  guides: "The playbook's guides: what its words mean, how each kind of definition is written, and recipes",
};

const resourcesOfOperations: Readonly<Record<string, string>> = {
  answer_interaction: 'interactions',
  render_playbook_page: 'playbooks',
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
