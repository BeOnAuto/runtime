import { Effect, Schema } from 'effect';

import { clickDelivery } from '../clicks/click-delivery.ts';
import type { DeliveredClick, PerformedClick } from '../clicks/click-intake.ts';
import type { Edit } from './chat-board.ts';
import { redrawingConversations } from './chat-conversations.ts';
import { answererId, chatHarness, type ChatHarness, type ChatHarnessOptions } from './chat-harness.ts';
import { threadReplies } from './documents.ts';
import { alpha } from './interaction-harness.ts';
import { renderedDelivery } from './rendered-documents.ts';
import { theChannel } from './woken-conversations.ts';

export const clickedRun = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7e';

const withoutTell = threadReplies.filter(
  (line) => !line.startsWith('  tell:') && !line.startsWith('    with:') && !/^ {6}/u.test(line),
);

const choiceRule: readonly string[] = [
  'reply:',
  '  choice:',
  '    from: word',
  '    words:',
  '      approve: [approved, yes, ok]',
  '      reject: [rejected, no]',
];

const rowsAnswer: readonly string[] = [
  'output:',
  '  schema:',
  '    type: object',
  '    required: [decisions]',
  '    properties:',
  '      decisions:',
  '        type: object',
  '        required: [a, b]',
  '        properties:',
  '          a: { type: string, enum: [approve, reject] }',
  '          b: { type: string, enum: [approve, reject] }',
];

const choiceAnswer: readonly string[] = [
  'output:',
  '  schema:',
  '    type: object',
  '    required: [choice]',
  '    properties:',
  '      choice: { type: string, enum: [approve, reject] }',
];

const rowsInput: readonly string[] = [
  'input:',
  '  schema:',
  '    type: object',
  '    required: [team, owner, items]',
  '    properties:',
  '      team: { type: string }',
  '      owner: { type: string }',
  '      items: { type: array, items: { type: object, required: [id], properties: { id: { type: string } } } }',
];

const choiceInput: readonly string[] = [
  'input:',
  '  schema:',
  '    type: object',
  '    required: [team, owner, campaign]',
  '    properties:',
  '      team: { type: string }',
  '      owner: { type: string }',
  '      campaign: { type: string }',
];

const rowsCard: readonly string[] = [
  'root: card',
  'elements:',
  '  card:',
  '    type: Card',
  '    props: { title: Brand review }',
  '    children: [rows, everything, footnote]',
  '  rows:',
  '    type: Section',
  '    repeat: { statePath: /input/items }',
  '    children: [name, row]',
  '  name:',
  '    type: Text',
  '    props: { content: { $item: id } }',
  '  row:',
  '    type: Actions',
  '    children: [approve, reject]',
  '  approve:',
  '    type: Button',
  '    props:',
  '      label: Approve',
  '      style: primary',
  '      once: true',
  "      sets: [{ at: { $template: '/decisions/${id}' }, value: approve }]",
  '  reject:',
  '    type: Button',
  '    props:',
  '      label: Reject',
  '      style: danger',
  '      once: true',
  "      sets: [{ at: { $template: '/decisions/${id}' }, value: reject }]",
  '  everything:',
  '    type: Actions',
  '    children: [all]',
  '  all:',
  '    type: Button',
  '    props:',
  '      label: Approve all',
  '      once: true',
  '      sets: [{ at: /decisions/a, value: approve }, { at: /decisions/b, value: approve }]',
  '  footnote:',
  '    type: Text',
  '    props: { content: Click a button or reply in the thread, style: muted }',
];

const choiceCard: readonly string[] = [
  'root: card',
  'elements:',
  '  card:',
  '    type: Card',
  '    props: { title: Campaign brief }',
  '    children: [ask, row]',
  '  ask:',
  '    type: Text',
  '    props: { content: Approve the brief?, style: bold }',
  '  row:',
  '    type: Actions',
  '    children: [approve, reject]',
  '  approve:',
  '    type: Button',
  '    props: { label: Approve, style: primary, sets: [{ at: /choice, value: approve }] }',
  '  reject:',
  '    type: Button',
  '    props: { label: Reject, style: danger, sets: [{ at: /choice, value: reject }] }',
];

function documentOf(
  answer: readonly string[],
  input: readonly string[],
  card: readonly string[],
  rule: readonly string[],
): string {
  return [
    '---',
    "to: '#approvals-{{ input.team }}'",
    "from: '{{ input.owner }}'",
    'expires: P2D',
    'render: slack',
    ...renderedDelivery,
    ...withoutTell,
    ...input,
    ...answer,
    ...rule,
    '---',
    ...card,
  ].join('\n');
}

function quietDocumentOf(answer: readonly string[], input: readonly string[], card: readonly string[]): string {
  return [
    '---',
    "to: '{{ input.owner }}'",
    'expires: P2D',
    'render: slack',
    ...renderedDelivery,
    ...input,
    ...answer,
    '---',
    ...card,
  ].join('\n');
}

export const quietRowsDocument = quietDocumentOf(rowsAnswer, rowsInput, rowsCard);

export const rowsDocument = documentOf(rowsAnswer, rowsInput, rowsCard, []);

export const choiceDocument = documentOf(choiceAnswer, choiceInput, choiceCard, choiceRule);

export const rowsInputValue = { team: 'sales', owner: answererId, items: [{ id: 'a' }, { id: 'b' }] };

export const choiceInputValue = { team: 'sales', owner: answererId, campaign: 'Spring' };

const isBlocks = Schema.is(Schema.Array(Schema.Unknown));

const ButtonsSchema = Schema.Array(
  Schema.Struct({
    type: Schema.String,
    elements: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          action_id: Schema.optionalKey(Schema.String),
          text: Schema.optionalKey(Schema.Union([Schema.String, Schema.Struct({ text: Schema.String })])),
        }),
      ),
    ),
  }),
);

export interface ButtonShown {
  readonly label: string;
  readonly action: string;
}

export function buttonsIn(blocks?: unknown): readonly ButtonShown[] {
  const decoded = Schema.decodeUnknownSync(ButtonsSchema)(isBlocks(blocks) ? blocks : []);
  return decoded.flatMap(({ elements = [] }) =>
    elements.flatMap(({ action_id: action, text }) =>
      action === undefined || typeof text !== 'object' ? [] : [{ label: text.text, action }],
    ),
  );
}

interface Differently {
  readonly to?: string;
  readonly now?: number;
}

export interface Clicking {
  readonly playbook: ChatHarness;
  readonly thread: string;
  readonly shownFirst: () => readonly ButtonShown[];
  readonly shownLast: () => readonly ButtonShown[];
  readonly click: (action: string, by?: string, id?: string, more?: Differently) => Promise<readonly PerformedClick[]>;
  readonly clickAll: (clicks: readonly DeliveredClick[]) => Promise<readonly PerformedClick[]>;
  readonly edits: () => readonly Edit[];
}

const firstPosted = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.Struct({ ts: Schema.String })));

interface Clicked {
  readonly document: string;
  readonly input: Schema.Json;
  readonly conversation: string;
  readonly recording?: ChatHarnessOptions['recording'] | undefined;
  readonly wrapped?: ((chat: ChatHarness['chat']) => ChatHarness['chat']) | undefined;
}

async function clickingOn({
  document,
  input,
  conversation,
  recording,
  wrapped = (chat) => chat,
}: Clicked): Promise<Clicking> {
  const playbook = await chatHarness({
    conversations: redrawingConversations,
    document,
    ...(recording === undefined ? {} : { recording }),
  });
  await playbook.ask('approve-brief', input, clickedRun);
  await playbook.performDue(Date.now());
  const [{ ts: thread }] = firstPosted(playbook.chat.posted());
  const record = recording?.(playbook.record) ?? playbook.record;
  const delivery = clickDelivery({ ledger: playbook.ledger.service, tools: wrapped(playbook.chat), record });
  const clock = { time: Date.now() };
  const posted = playbook.chat.calls().find(({ reference }) => reference.tool === 'post_message');
  const delivered = (clicks: readonly DeliveredClick[], now: number) =>
    Effect.runPromise(delivery({ playbook: alpha, connection: 'chat', conversation, clicks }, now));
  return {
    playbook,
    thread,
    shownFirst: () => buttonsIn(posted?.input['blocks']),
    shownLast: () => buttonsIn(playbook.chat.edits().at(-1)?.blocks),
    click: (action, by = answererId, id = `1699.${clock.time++}`, { to = thread, now = Date.now() } = {}) =>
      delivered([{ id, sender: by, to, action, time: clock.time }], now),
    clickAll: (clicks) => delivered(clicks, Date.now()),
    edits: () => playbook.chat.edits(),
  };
}

export function clicking(
  document: string,
  input: Schema.Json,
  recording?: ChatHarnessOptions['recording'],
  wrapped?: (chat: ChatHarness['chat']) => ChatHarness['chat'],
): Promise<Clicking> {
  return clickingOn({ document, input, conversation: theChannel, recording, wrapped });
}

export function clickingIn(
  document: string,
  input: Schema.Json,
  conversation: string,
  recording?: ChatHarnessOptions['recording'],
): Promise<Clicking> {
  return clickingOn({ document, input, conversation, recording });
}

export function actionOf(shown: readonly ButtonShown[], label: string, nth = 0): string {
  const found = shown.filter((button) => button.label === label).at(nth);
  if (found === undefined) {
    throw new Error(`No ${label} button`);
  }
  return found.action;
}
