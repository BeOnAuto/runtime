import { personWhoWrote, whoWrote } from '../people/who-is-who.ts';
import type { Posting } from '../service/service-calls.ts';
import type { ChatStore } from '../store/chat-store.ts';
import type { Arrival } from '../tables/chat-rows.ts';
import type { TurnSettled } from '../turn/chat-turn.ts';
import {
  AMBIENT,
  DIRECT_MESSAGE,
  MENTION,
  memberOf,
  whereOf,
  type ChatConnection,
  type ServingNow,
  type Taking,
} from './arrival-parts.ts';
import { underTheLease } from './leased-turns.ts';

export type Outcome =
  | TurnSettled
  | 'shared'
  | 'help'
  | 'disconnected'
  | 'not_connected'
  | 'told'
  | 'sign_in'
  | 'busy'
  | 'no_model'
  | 'passed'
  | 'restarted';

const commands = ['help', 'disconnect'] as const;

type Command = (typeof commands)[number];

function commandOf(text: string): Command | undefined {
  const lowered = text.toLowerCase();
  return commands.find((command) => command === lowered);
}

async function toldAlone({ message, connection }: Taking, words: Posting): Promise<void> {
  const where = whereOf(message);
  if (message.kind === DIRECT_MESSAGE) {
    await connection.service.answered(where, words);
    return;
  }
  await connection.service.toldAlone(where, words);
}

async function commandAnswered(taking: Taking, command: Command, serving: ServingNow): Promise<Outcome> {
  const { message, connection } = taking;
  const { words } = connection.render;
  const where = whereOf(message);
  if (command === 'help') {
    await connection.service.answered(where, words.help);
    return 'help';
  }
  const member = memberOf(connection, message);
  if ((await serving.store.links.linkOf(member)) === undefined) {
    await connection.service.answered(where, words.notConnected);
    return 'not_connected';
  }
  await serving.store.deletions.disconnected(member);
  await connection.service.answered(where, words.disconnected);
  return 'disconnected';
}

async function personTurn(taking: Taking, serving: ServingNow): Promise<Outcome> {
  const { message, connection } = taking;
  const { render, service } = connection;
  const text = render.withoutTheApp(message.text, message.app);
  if (message.shared && message.kind !== DIRECT_MESSAGE) {
    await toldAlone(taking, render.words.shared);
    return 'shared';
  }
  const command = commandOf(text);
  if (command !== undefined) {
    return commandAnswered(taking, command, serving);
  }
  const member = memberOf(connection, message);
  const where = whereOf(message);
  const asking = { member, where, text, service, render, accountName: connection.accountName };
  const known = await whoWrote(
    { ...asking, requestWaits: () => connection.requestWaitsIn(message.conversation) },
    serving.knowing,
  );
  if ('told' in known) {
    await toldAlone(taking, known.told);
    return 'told';
  }
  if ('signIn' in known) {
    await toldAlone(taking, render.lineWithALinkButton(known.signIn.line, render.words.signIn, known.signIn.address));
    return 'sign_in';
  }
  const leasing = await underTheLease(taking, { person: known.person, text, autoNotNamed: false }, serving);
  if ('turned' in leasing) {
    return leasing.turned;
  }
  if (leasing.not === 'busy') {
    await service.answered(where, render.words.stillWorking);
    return 'busy';
  }
  await toldAlone(taking, render.words.noModel);
  return 'no_model';
}

async function outrankedOrPassed(taking: Taking, serving: ServingNow): Promise<Outcome> {
  return (await serving.store.arrivals.passed(taking.arrival))
    ? 'passed'
    : personTurn({ ...taking, arrival: { ...taking.arrival, kind: MENTION } }, serving);
}

async function ambientTurn(taking: Taking, serving: ServingNow): Promise<Outcome> {
  const { message, connection, arrival } = taking;
  if ((await serving.store.arrivals.kindOf(arrival)) !== AMBIENT) {
    return personTurn({ ...taking, arrival: { ...arrival, kind: MENTION } }, serving);
  }
  const member = memberOf(connection, message);
  const person = message.shared
    ? undefined
    : await personWhoWrote({ member, where: whereOf(message), service: connection.service }, serving.knowing);
  if (person === undefined) {
    return outrankedOrPassed(taking, serving);
  }
  const text = connection.render.withoutTheApp(message.text, message.app);
  const leasing = await underTheLease(taking, { person, text, autoNotNamed: true }, serving);
  if ('turned' in leasing && leasing.turned !== 'unaddressed') {
    return leasing.turned;
  }
  return outrankedOrPassed(taking, serving);
}

export async function arrivalTaken(taking: Taking, serving: ServingNow): Promise<Outcome> {
  try {
    return await (taking.arrival.kind === AMBIENT ? ambientTurn(taking, serving) : personTurn(taking, serving));
  } finally {
    await serving.store.arrivals.settled(taking.arrival);
  }
}

export async function restartTold(arrival: Arrival, connection: ChatConnection | undefined, store: ChatStore) {
  if (connection !== undefined && arrival.kind !== AMBIENT) {
    const where = {
      id: arrival.message,
      conversation: arrival.conversation,
      thread: undefined,
      sender: '',
      kind: arrival.kind,
    };
    await connection.service.answered(where, connection.render.words.notAnswered);
  }
  await store.arrivals.settled(arrival);
  return 'restarted';
}
