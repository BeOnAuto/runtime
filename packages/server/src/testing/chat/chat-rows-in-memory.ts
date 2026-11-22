import type {
  Arrival,
  ArrivalKey,
  ChatRows,
  ConversationPlace,
  ConversationRow,
  KeyedConversation,
  AccountLink,
  LinkStart,
  SealedRow,
} from '../../chat/tables/chat-rows.ts';
import { linksIn } from './links-in-memory.ts';
import { keyOf, tableOf, type Table } from './memory-tables.ts';

interface ArrivalKept extends Arrival {
  readonly state: 'taken' | 'settled';
  readonly arrivedAt: number;
}

interface ConversationKept extends ConversationRow {
  readonly holder: string | undefined;
  readonly until: number | undefined;
}

interface MessageKept extends SealedRow {
  readonly conversation: string;
}

const arrivalKeyOf = ({ connection, account, conversation, message }: ArrivalKey): string =>
  keyOf(connection, account, conversation, message);

const placeKeyOf = ({ connection, account, conversation, thread = '' }: ConversationPlace): string =>
  keyOf(connection, account, conversation, thread);

const messageKeyOf = (conversation: string, sequence: number): string => keyOf(conversation, String(sequence));

const byOrder = (left: string, right: string): number => Number(left > right) - Number(left < right);

const keyedOf = ({ id, keyId }: ConversationKept): KeyedConversation => ({ id, keyId });

function arrivalsIn(arrivals: Table<ArrivalKept>): ChatRows['arrivals'] {
  const arrivedFirst = (left: ArrivalKept, right: ArrivalKept): number =>
    left.arrivedAt === right.arrivedAt
      ? byOrder(arrivalKeyOf(left), arrivalKeyOf(right))
      : left.arrivedAt - right.arrivedAt;
  return {
    claimed: (arrival, at) => {
      const claimed = arrivals.found(arrivalKeyOf(arrival)) === undefined;
      if (claimed) {
        arrivals.put(arrivalKeyOf(arrival), { ...arrival, state: 'taken', arrivedAt: at });
      }
      return Promise.resolve(claimed);
    },
    settled: (arrival) => {
      const kept = arrivals.found(arrivalKeyOf(arrival));
      if (kept !== undefined) {
        arrivals.put(arrivalKeyOf(kept), { ...kept, state: 'settled' });
      }
      return Promise.resolve();
    },
    unsettled: () =>
      Promise.resolve(
        arrivals
          .rows()
          .filter(({ state }) => state === 'taken')
          .toSorted(arrivedFirst)
          .map(({ connection, account, conversation, message, kind }) => ({
            connection,
            account,
            conversation,
            message,
            kind,
          })),
      ),
    deleted: (selected) =>
      Promise.resolve(
        arrivals.deleted((arrival) =>
          'connection' in selected
            ? arrival.connection === selected.connection
            : arrival.account === selected.account && arrival.conversation === selected.conversation,
        ),
      ),
  };
}

function sendersIn(messages: Table<MessageKept>, conversation: string): readonly string[] {
  const senders = messages
    .rows()
    .flatMap((message) =>
      message.conversation === conversation && message.sender !== undefined ? [message.sender] : [],
    );
  return [...new Set(senders)].toSorted(byOrder);
}

function conversationsIn(conversations: Table<ConversationKept>, messages: Table<MessageKept>) {
  const sorted = (rows: readonly ConversationKept[]) => rows.toSorted((left, right) => byOrder(left.id, right.id));
  const rows: Pick<ChatRows['conversations'], 'selected' | 'writtenIn' | 'deleted'> = {
    selected: (selected) =>
      Promise.resolve(
        sorted(
          conversations
            .rows()
            .filter((row) =>
              'connection' in selected
                ? row.connection === selected.connection
                : row.account === selected.account &&
                  row.conversation === selected.conversation &&
                  (selected.thread === undefined || row.thread === selected.thread),
            ),
        ).map((row) => keyedOf(row)),
      ),
    writtenIn: ({ account, member }) =>
      Promise.resolve(
        sorted(
          conversations
            .rows()
            .filter(
              (row) =>
                row.account === account &&
                messages.rows().some((each) => each.conversation === row.id && each.sender === member),
            ),
        ).map(({ id, keyId }) => ({ id, keyId, senders: sendersIn(messages, id) })),
      ),
    deleted: (ids) => {
      const deleted = new Set(ids);
      messages.deleted(({ conversation }) => deleted.has(conversation));
      conversations.deleted(({ id }) => deleted.has(id));
      return Promise.resolve();
    },
  };
  return rows;
}

function leasesIn(
  conversations: Table<ConversationKept>,
): Pick<ChatRows['conversations'], 'found' | 'made' | 'leaseTaken' | 'leaseReleased'> {
  const placed = (place: ConversationPlace) =>
    conversations.rows().find((row) => placeKeyOf(row) === placeKeyOf(place));
  return {
    found: (place) => {
      const kept = placed(place);
      return Promise.resolve(kept === undefined ? undefined : { ...place, id: kept.id, keyId: kept.keyId });
    },
    made: (row) => {
      const made = placed(row) === undefined;
      if (made) {
        conversations.put(row.id, { ...row, thread: row.thread ?? '', holder: undefined, until: undefined });
      }
      return Promise.resolve(made);
    },
    leaseTaken: (id, { holder, now, until }) => {
      const kept = conversations.found(id);
      const taken = kept !== undefined && (kept.until === undefined || kept.until <= now);
      if (taken) {
        conversations.put(id, { ...kept, holder, until });
      }
      return Promise.resolve(taken);
    },
    leaseReleased: (id, holder) => {
      const kept = conversations.found(id);
      if (kept?.holder === holder) {
        conversations.put(id, { ...kept, holder: undefined, until: undefined });
      }
      return Promise.resolve();
    },
  };
}

function messagesIn(conversations: Table<ConversationKept>, messages: Table<MessageKept>): ChatRows['messages'] {
  const of = (conversation: string) =>
    messages
      .rows()
      .filter((message) => message.conversation === conversation)
      .toSorted((left, right) => left.sequence - right.sequence);
  return {
    newest: (conversation, most) =>
      Promise.resolve(
        of(conversation)
          .slice(-most)
          .map(({ sequence, author, sender, sealed }) => ({ sequence, author, sender, sealed })),
      ),
    last: (conversation) => Promise.resolve(Math.max(0, ...of(conversation).map(({ sequence }) => sequence))),
    appended: (conversation, holder, rows) => {
      if (conversations.found(conversation)?.holder !== holder) {
        return Promise.resolve(false);
      }
      if (rows.some(({ sequence }) => messages.found(messageKeyOf(conversation, sequence)) !== undefined)) {
        return Promise.reject(new Error(`The conversation ${conversation} holds a message of that sequence already`));
      }
      for (const row of rows) {
        messages.put(messageKeyOf(conversation, row.sequence), { ...row, conversation });
      }
      return Promise.resolve(true);
    },
    senderDeleted: ({ account, member }) => {
      messages.deleted(
        (message) => message.sender === member && conversations.found(message.conversation)?.account === account,
      );
      return Promise.resolve();
    },
  };
}

export function chatRowsInMemory(): ChatRows {
  const conversations = tableOf<ConversationKept>();
  const messages = tableOf<MessageKept>();
  return {
    arrivals: arrivalsIn(tableOf<ArrivalKept>()),
    conversations: { ...leasesIn(conversations), ...conversationsIn(conversations, messages) },
    messages: messagesIn(conversations, messages),
    links: linksIn(tableOf<AccountLink>(), tableOf<LinkStart>()),
  };
}
