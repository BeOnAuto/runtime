export interface CallOptions {
  readonly server?: string;
  readonly tool?: string;
  readonly read?: string | null;
  readonly with?: readonly string[];
  readonly front?: readonly string[];
  readonly input?: readonly string[];
  readonly output?: readonly string[];
  readonly body?: string;
}

const threadArguments: readonly string[] = [
  "    channel: '{{ input.channel }}'",
  "    ts: '{{ input.thread }}'",
  '    limit: 100',
  '    inclusive: false',
];

const threadInput: readonly string[] = [
  'input:',
  '  schema:',
  '    type: object',
  '    required: [channel, thread]',
  '    properties:',
  '      channel: { type: string }',
  '      thread: { type: string }',
];

export const repliesOutput: readonly string[] = [
  'output:',
  '  schema:',
  '    type: array',
  '    maxItems: 100',
  '    items:',
  '      type: object',
  '      required: [user, text, ts]',
  '      properties:',
  '        user: { type: string }',
  '        text: { type: string }',
  '        ts: { type: string }',
];

function argumentsOf(written: readonly string[]): readonly string[] {
  return written.length === 0 ? [] : ['  with:', ...written];
}

function readOf(read: string | null): readonly string[] {
  return read === null ? [] : [`  read: ${read}`];
}

export function callDocument({
  server = 'chat',
  tool = 'thread',
  read = '/messages',
  with: written = threadArguments,
  front = [],
  input = threadInput,
  output = repliesOutput,
  body = '',
}: CallOptions = {}): string {
  return [
    '---',
    'description: Read the replies of a thread in the team chat, oldest first',
    'call:',
    `  server: ${server}`,
    `  tool: ${tool}`,
    ...argumentsOf(written),
    ...readOf(read),
    ...front,
    ...input,
    ...output,
    '---',
    body,
  ].join('\n');
}
