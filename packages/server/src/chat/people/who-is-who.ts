import type { ChatRendering } from '@on.auto/interaction';

import { codeHandedBack, linkStarted } from '../../account-linking/account-linking.ts';
import type { AccountLinks, MemberOfAnAccount } from '../../account-linking/account-links.ts';
import type { KeyedHash } from '../../account-linking/link-secrets.ts';
import type { ChatService, SenderRead, WhereWritten } from '../service/service-calls.ts';

export interface Knowing {
  readonly links: AccountLinks;
  readonly hashed: KeyedHash;
  readonly publicUrl: string;
  readonly holdsARole: (person: string) => Promise<boolean>;
  readonly personOfAVerifiedAddress: (address: string) => Promise<string | undefined>;
  readonly nameOf: (person: string) => Promise<string>;
  readonly now: () => number;
}

export interface Asking {
  readonly member: MemberOfAnAccount;
  readonly where: WhereWritten;
  readonly text: string;
  readonly service: ChatService;
  readonly render: ChatRendering;
  readonly accountName: string | undefined;
  readonly requestWaits: () => Promise<boolean>;
}

export type Known =
  | { readonly person: string }
  | { readonly told: string }
  | { readonly signIn: { readonly line: string; readonly address: string } };

async function linkedPersonOf(member: MemberOfAnAccount, knowing: Knowing): Promise<string | undefined> {
  const link = await knowing.links.linkOf(member);
  return link !== undefined && (await knowing.holdsARole(link.person)) ? link.person : undefined;
}

function confirmedAddressOf(read: SenderRead | undefined, { account }: MemberOfAnAccount): string | undefined {
  return read?.verified === true && read.active && read.account === account ? read.email : undefined;
}

async function connectedWords({ render, accountName }: Asking, person: string, knowing: Knowing): Promise<string> {
  return render.words.connected({ account: accountName ?? render.service, person: await knowing.nameOf(person) });
}

async function signInLine(asking: Asking, confirmed: string | undefined): Promise<string> {
  const { words } = asking.render;
  const line = confirmed === undefined ? words.signInToUse : words.notRecognised;
  return (await asking.requestWaits()) ? `${line} ${words.toAnswerARequest}` : line;
}

async function codeOrStart(asking: Asking, confirmed: string | undefined, knowing: Knowing): Promise<Known> {
  const { member, text, render } = asking;
  const handed = await codeHandedBack(knowing, member, text, knowing.now());
  if ('linked' in handed) {
    return { told: await connectedWords(asking, handed.linked, knowing) };
  }
  if ('refused' in handed) {
    return { told: handed.refused === 'wrong_code' ? render.words.wrongCode : render.words.anotherMember };
  }
  const address = await linkStarted(knowing.links, knowing.publicUrl, member);
  return { signIn: { line: await signInLine(asking, confirmed), address } };
}

interface Recognised {
  readonly person: string | undefined;
  readonly confirmed: string | undefined;
}

async function recognised(asking: Pick<Asking, 'member' | 'where' | 'service'>, knowing: Knowing): Promise<Recognised> {
  const linked = await linkedPersonOf(asking.member, knowing);
  if (linked !== undefined) {
    return { person: linked, confirmed: undefined };
  }
  const read = await asking.service.sender(asking.where);
  const confirmed = confirmedAddressOf(read, asking.member);
  const person = confirmed === undefined ? undefined : await knowing.personOfAVerifiedAddress(confirmed);
  return { person, confirmed };
}

export async function personWhoWrote(
  asking: Pick<Asking, 'member' | 'where' | 'service'>,
  knowing: Knowing,
): Promise<string | undefined> {
  return (await recognised(asking, knowing)).person;
}

export async function whoWrote(asking: Asking, knowing: Knowing): Promise<Known> {
  const { person, confirmed } = await recognised(asking, knowing);
  return person === undefined ? codeOrStart(asking, confirmed, knowing) : { person };
}
