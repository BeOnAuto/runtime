const answerSchema = [
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
  '      note: { type: string, maxLength: 2000 }',
];

export const datedAnswerSchema: readonly string[] = [...answerSchema, '      due: { type: string, format: date }'];

const inputSchema = [
  'input:',
  '  schema:',
  '    type: object',
  '    required: [campaign, owner]',
  '    properties:',
  '      campaign: { type: string }',
  '      owner: { type: string }',
];

export const chatDelivery: readonly string[] = [
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  "    channel: '#approvals-{{ to }}'",
  "    text: '{{ message }}'",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
];

export const agentDelivery: readonly string[] = ['deliver: agent'];

export function approvalDocument(
  delivery: readonly string[] = agentDelivery,
  expires = 'P2D',
  answer: readonly string[] = answerSchema,
): string {
  return [
    '---',
    'description: Ask the campaign owner to approve a brief',
    "to: '{{ input.owner }}'",
    `expires: ${expires}`,
    ...delivery,
    ...inputSchema,
    ...answer,
    '---',
    'Please review the brief for {{ input.campaign }}.',
  ].join('\n');
}

export function notificationDocument(delivery: readonly string[] = chatDelivery, expires = 'PT1H'): string {
  return [
    '---',
    "to: '{{ input.owner }}'",
    `expires: ${expires}`,
    ...delivery,
    ...inputSchema,
    '---',
    'The brief for {{ input.campaign }} is out.',
  ].join('\n');
}

export const replyRuleLines: readonly string[] = [
  'reply:',
  '  choice:',
  '    from: word',
  '    words:',
  '      approve: [approved, yes, ok]',
  '      reject: [rejected, no]',
  '  note: rest',
];

export const threadReplies: readonly string[] = [
  'replies:',
  "  conversation: '{{ sent.conversation }}/{{ sent.id }}'",
  '  tool: thread_replies',
  '  with:',
  "    channel: '{{ sent.conversation }}'",
  "    ts: '{{ sent.id }}'",
  `    oldest: '{{ since | default: "0" }}'`,
  '    limit: 15',
  '  read:',
  '    list: /messages',
  '    order: oldest_first',
  '    each: { id: /ts, sender: /user, text: /text, to: /thread_ts }',
  '  wait: PT1M',
  '  tell:',
  '    with:',
  "      channel: '{{ sent.conversation }}'",
  "      thread_ts: '{{ sent.id }}'",
  "      text: '{{ message }}'",
];

const teamDelivery: readonly string[] = [
  'deliver:',
  '  server: chat',
  '  tool: post_message',
  '  with:',
  "    channel: '{{ to }}'",
  "    text: '{{ message }}'",
  '  sent:',
  '    conversation: /channel',
  '    id: /ts',
];

const teamInput: readonly string[] = [
  'input:',
  '  schema:',
  '    type: object',
  '    required: [team, owner, campaign]',
  '    properties:',
  '      team: { type: string }',
  '      owner: { type: string }',
  '      campaign: { type: string }',
];

export interface ThreadOptions {
  readonly rule?: readonly string[];
  readonly replies?: readonly string[];
}

export function threadDocument({ rule = replyRuleLines, replies = threadReplies }: ThreadOptions = {}): string {
  return [
    '---',
    "description: Ask the campaign's owner to approve a brief",
    "to: '#approvals-{{ input.team }}'",
    "from: '{{ input.owner }}'",
    'expires: P2D',
    ...teamDelivery,
    ...replies,
    ...teamInput,
    ...answerSchema,
    ...rule,
    '---',
    'Please review the brief for {{ input.campaign }}.',
    '',
    'Reply **approve** or **reject**, with a note if you reject.',
  ].join('\n');
}
