import type {
  AccountLink,
  ChatRows,
  LinkStart,
  LinksSelected,
  MemberOfAnAccount,
} from '../../chat/tables/chat-rows.ts';
import { keyOf, type Table } from './memory-tables.ts';

const memberKeyOf = ({ account, member }: MemberOfAnAccount): string => keyOf(account, member);

const byMember = (left: LinkStart, right: LinkStart): number =>
  Number(memberKeyOf(left) > memberKeyOf(right)) - Number(memberKeyOf(left) < memberKeyOf(right));

function isSelected(row: MemberOfAnAccount & { readonly person?: string }, selected: LinksSelected): boolean {
  if ('person' in selected) {
    return row.person === selected.person;
  }
  return row.account === selected.account && (!('member' in selected) || row.member === selected.member);
}

export function linksIn(links: Table<AccountLink>, starts: Table<LinkStart>): ChatRows['links'] {
  return {
    started: (start) => {
      starts.put(memberKeyOf(start), start);
      return Promise.resolve();
    },
    startFound: (secret) =>
      Promise.resolve(
        starts
          .rows()
          .filter((start) => start.secret === secret)
          .toSorted(byMember)
          .at(0),
      ),
    startOf: (member) => Promise.resolve(starts.found(memberKeyOf(member))),
    startEnded: (ended) =>
      Promise.resolve(
        starts.deleted((start) => memberKeyOf(start) === memberKeyOf(ended) && start.secret === ended.secret),
      ),
    linked: (link) => {
      links.put(memberKeyOf(link), link);
      return Promise.resolve();
    },
    linkOf: (member) => Promise.resolve(links.found(memberKeyOf(member))),
    personForgotten: (person) => {
      starts.deleted((start) => start.person === person);
      links.deleted((link) => link.person === person);
      return Promise.resolve();
    },
    linksDeleted: (selected) => Promise.resolve(links.deleted((link) => isSelected(link, selected))),
    startsDeleted: (selected) => Promise.resolve(starts.deleted((start) => isSelected(start, selected))),
  };
}
