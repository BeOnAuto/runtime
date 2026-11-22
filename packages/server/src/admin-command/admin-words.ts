import { resolvedLedgerFile, whereTheLedgerIsKept, type LedgerSettings } from '../settings/ledger-settings.ts';

export interface Said {
  readonly said: 'out' | 'refused';
  readonly lines: readonly string[];
}

export function out(...lines: readonly string[]): Said {
  return { said: 'out', lines };
}

export function refused(...lines: readonly string[]): Said {
  return { said: 'refused', lines };
}

export const adminHelp: readonly string[] = [
  'admin grant-admin <email>  Make a person who has signed in an Admin, for when every Admin has left',
  'admin reset-setup          Start setup over, for when the first sign-in tied this server to the wrong organization. Signs everyone out',
  'admin register-client      Register this server with the identity provider again, for when its registration there was deleted',
  "admin delete-chat member <account> <member>  Delete everything this server keeps that a member of a chat app wrote, and their link to Auto, for when they ask for it to be deleted. <account> is the ID of the account the chat app's connection is for, and <member> the member's ID in it",
  'admin delete-chat conversation <account> <conversation> [<thread>]  Delete what this server keeps of a conversation with Auto in a chat app, or of one of its threads, by their IDs in the account, for when someone asks for it to be deleted',
];

export const whereTheAdminCommandsRun =
  "The admin commands read and write the server's ledger: run them where the server runs, with its settings. The server can be running or stopped.";

export function noCommandIn(args: readonly string[]): string {
  return `auto-runtime has no command "${args.join(' ')}"`;
}

export function ledgerRead(ledger: LedgerSettings): string {
  return ledger.store === 'postgresql'
    ? 'The ledger read is the database DATABASE_URL gives.'
    : `The ledger read is the file ${resolvedLedgerFile(ledger.file)}.`;
}

export function ledgerNotOpened(words: string): string {
  return `The command could not open the ledger: ${words}`;
}

export function ledgerOfAnEarlierVersion(ledger: LedgerSettings): string {
  return `${whereTheLedgerIsKept(ledger)}, and was made by an earlier version of Auto Runtime. The command does not carry a ledger forward: start this version of Auto Runtime first, then run the command again.`;
}

export const ledgerChanged = 'The ledger changed while the command ran. Nothing was recorded. Run it again.';

export interface PersonNamed {
  readonly name?: string | undefined;
  readonly emailAddress: string;
}

function namedAs({ name, emailAddress }: PersonNamed): string {
  return name === undefined ? emailAddress : `${name} (${emailAddress})`;
}

export function madeAnAdmin(person: PersonNamed): string {
  return `${namedAs(person)} is now an Admin.`;
}

export function alreadyAnAdmin(person: PersonNamed): string {
  return `${namedAs(person)} is already an Admin. Nothing changed.`;
}

export function noOneSignedInAs(emailAddress: string): string {
  return `No one with the email address ${emailAddress} has signed in to this server. Ask them to sign in, then run this command again.`;
}

export function severalSignedInAs(emailAddress: string): string {
  return `More than one person who has signed in has the email address ${emailAddress}, so no one was made an Admin.`;
}

export const emailAddressAsked = 'Give the email address of the person to make an Admin: admin grant-admin <email>';

export const setupStartedOver: readonly string[] = [
  'Setup has started over and everyone is signed out. The next person to sign in ties this server to their organization.',
  'If they are not an Admin afterwards, run admin grant-admin with their email address.',
];

export function signOutUnconfirmed(reason: string): string {
  return `Setup has started over, but the command could not confirm that everyone is signed out: ${reason}. Run it again.`;
}

export const setupNotTied =
  'This server is not tied to an organization yet: the first person to sign in ties it. Nothing changed.';

export const setupGivenBySetting =
  'OIDC_REQUIRED_CLAIM gives the value every sign-in must carry, so there is nothing to start over. To change it, change that setting and start the server again. Nothing changed.';

export function clientRegistered(issuer: string, clientId: string, replacing: string | undefined): string {
  const inPlaceOf = replacing === undefined ? '' : `, in place of the client ${replacing}`;
  return `This server is registered with the identity provider at ${issuer} as the client ${clientId}${inPlaceOf}. The next sign-in uses it; the server needs no restart.`;
}

export function clientRegisteredElsewhereFirst(issuer: string, inUse: string, unused: string): string {
  return `Another server of this database registered with the identity provider at ${issuer} at the same moment, so people are signed in as its client ${inUse}. The client ${unused} registered just now stays unused there.`;
}

export const clientGivenBySetting =
  'OIDC_CLIENT_ID gives the client this server signs people in as, so there is nothing to register. If that client was deleted, register Auto with the identity provider by hand again, then set OIDC_CLIENT_ID together with OIDC_CLIENT_SECRET or OIDC_CLIENT_SECRET_FILE.';

export const noOneSignsIn = 'This server signs no one in, since PUBLIC_URL is not set. There is nothing to register.';

export const chatDeletionAsked =
  "Say what to delete: admin delete-chat member <account> <member> for what one member wrote, or admin delete-chat conversation <account> <conversation> [<thread>] for a conversation or one of its threads. <account> is the ID of the account the chat app's connection is for.";

export function chatTablesNotOpened(words: string): string {
  return `The command could not open the chat tables: ${words}`;
}

export interface ChatMemberNamed {
  readonly account: string;
  readonly member: string;
}

export function memberChatDeleted({ account, member }: ChatMemberNamed): string {
  return `Deleted everything this server kept that the member ${member} in the account ${account} wrote, each thread or conversation without threads that only they wrote in, with Auto's answers there, and their link to Auto. Where someone else also wrote in a thread, Auto's answers there are kept, including its answers to this member.`;
}

export function noChatOfMember({ account, member }: ChatMemberNamed): string {
  return `This server keeps nothing that the member ${member} in the account ${account} wrote, and no link of theirs to Auto, so nothing was deleted.`;
}

export interface ChatConversationNamed {
  readonly account: string;
  readonly conversation: string;
  readonly thread?: string | undefined;
}

export function chatConversationDeleted({ account, conversation, thread }: ChatConversationNamed): string {
  return thread === undefined
    ? `Deleted what this server kept of the conversation ${conversation} in the account ${account}, in every thread of it.`
    : `Deleted the messages this server kept of the thread ${thread} of the conversation ${conversation} in the account ${account}.`;
}

export function noChatConversation({ account, conversation, thread }: ChatConversationNamed): string {
  return thread === undefined
    ? `This server keeps nothing of the conversation ${conversation} in the account ${account}, so nothing was deleted.`
    : `This server keeps no messages of the thread ${thread} of the conversation ${conversation} in the account ${account}, so nothing was deleted.`;
}
