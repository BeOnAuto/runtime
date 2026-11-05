import { listedOf, type ListedTool } from '../tools/tool-listing.ts';

export interface ShownArgument {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
  readonly oneOf: readonly string[];
  readonly pattern: string | undefined;
  readonly maxLength: number | undefined;
}

export interface ShownTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly hints: readonly string[];
  readonly arguments: readonly ShownArgument[];
}

export interface ToolGroup {
  readonly name: string;
  readonly tools: readonly ShownTool[];
}

const groups: readonly (readonly [string, readonly string[]])[] = [
  [
    'Playbooks',
    ['create_playbook', 'list_playbooks', 'get_playbook', 'update_playbook', 'retire_playbook', 'restore_playbook'],
  ],
  [
    'Definitions',
    [
      'create_definition',
      'list_definitions',
      'get_definition',
      'update_definition',
      'pause_definition',
      'resume_definition',
      'retire_definition',
      'restore_definition',
    ],
  ],
  [
    'Runs',
    [
      'run_definition',
      'get_run',
      'cancel_run',
      'list_runs',
      'send_run_event',
      'list_interactions',
      'answer_interaction',
    ],
  ],
  ['Events and history', ['publish_event', 'list_playbook_events', 'get_event']],
  ['Tool servers', ['list_models', 'search', 'introspect', 'dry_run', 'query_connection', 'execute_connection']],
  [
    'Connections',
    ['add_connection', 'list_connections', 'list_connection_tools', 'reconnect_connection', 'remove_connection'],
  ],
  ['Comments', ['list_comments', 'resolve_comment']],
  ['Assets', ['get_asset']],
  ['License', ['activate_license']],
  ['Guides', ['get_guide']],
];

const otherTools = 'Other';

type SchemaNode = ReadonlyMap<string, unknown>;

function nodeOf(value: unknown): SchemaNode {
  return typeof value === 'object' && value !== null ? new Map(Object.entries(value)) : new Map();
}

function textIn(node: SchemaNode, key: string): string | undefined {
  const value = node.get(key);
  return typeof value === 'string' ? value : undefined;
}

function listIn(node: SchemaNode, key: string): readonly unknown[] {
  const value = node.get(key);
  return Array.isArray(value) ? value : [];
}

function typeOf(node: SchemaNode): string {
  return (
    textIn(node, 'type') ??
    listIn(node, 'anyOf')
      .map((choice) => typeOf(nodeOf(choice)))
      .join(' | ')
  );
}

function lengthIn(node: SchemaNode): number | undefined {
  const value = node.get('maxLength');
  return typeof value === 'number' ? value : undefined;
}

function argumentsOf(schema: SchemaNode, prefix: string): readonly ShownArgument[] {
  const required = listIn(schema, 'required');
  const properties: readonly (readonly [string, unknown])[] = [...nodeOf(schema.get('properties'))];
  return properties.flatMap(([name, value]) => {
    const node = nodeOf(value);
    const shown: ShownArgument = {
      name: `${prefix}${name}`,
      type: typeOf(node),
      required: required.includes(name),
      description: textIn(node, 'description') ?? '',
      oneOf: listIn(node, 'enum').map(String),
      pattern: textIn(node, 'pattern'),
      maxLength: lengthIn(node),
    };
    return [shown].concat(argumentsOf(node, `${shown.name}.`));
  });
}

function hintsOf({
  readOnlyHint,
  destructiveHint,
  idempotentHint,
  openWorldHint,
}: ShownAnnotations): readonly string[] {
  return [
    ...(readOnlyHint === true ? ['reads only'] : []),
    ...(destructiveHint === true ? ['may destroy'] : []),
    ...(idempotentHint === true ? ['safe to repeat'] : []),
    ...(openWorldHint === true ? ['reaches outside'] : []),
  ];
}

type ShownAnnotations = ReturnType<typeof listedOf>['annotations'];

export function shownToolOf(tool: ListedTool): ShownTool {
  const { name, title, description, inputSchema, annotations } = listedOf(tool);
  return { name, title, description, hints: hintsOf(annotations), arguments: argumentsOf(nodeOf(inputSchema), '') };
}

function inGroupOrder(names: readonly string[]): (one: ShownTool, other: ShownTool) => number {
  return (one, other) => names.indexOf(one.name) - names.indexOf(other.name);
}

export function toolGroupsOf(tools: readonly ShownTool[]): readonly ToolGroup[] {
  const grouped: readonly ToolGroup[] = groups.map(([name, names]) => ({
    name,
    tools: tools.filter((tool) => names.includes(tool.name)).toSorted(inGroupOrder(names)),
  }));
  const named = new Set(groups.flatMap(([, names]) => names));
  const other = { name: otherTools, tools: tools.filter((tool) => !named.has(tool.name)) };
  return [...grouped, other].filter((group) => group.tools.length > 0);
}
