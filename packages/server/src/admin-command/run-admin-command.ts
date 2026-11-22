import { providerRequestsOverTheNetwork, type ProviderRequests } from '@on.auto/openid-connect';
import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';

import { shippedRoots } from '../server-options/shipped-roots.ts';
import { settingsAtStart } from '../settings/shipped-settings.ts';
import { noCommandIn, refused, type Said } from './admin-words.ts';
import { chatDeletedBy } from './delete-chat.ts';
import { adminGrantedBy } from './grant-admin.ts';
import { withTheLedgerOpened, type Opened, type Opening } from './opened-for-a-command.ts';
import { clientRegisteredBy } from './register-client.ts';
import { setupStartedOverBy } from './reset-setup.ts';

interface AdminConsole {
  readonly log: (line: string) => void;
  readonly error: (line: string) => void;
}

type SettingsGiven = Parameters<typeof settingsAtStart>;

export interface AdminHost {
  readonly environment: SettingsGiven[0];
  readonly console: AdminConsole;
  readonly usage: string;
  readonly defaultIdentityProvider?: SettingsGiven[2];
  readonly requests?: ProviderRequests;
}

interface Asked {
  readonly settings: Opened['settings'];
  readonly open: Opening;
  readonly given: readonly string[];
  readonly requests: ProviderRequests;
}

interface Verb {
  readonly takes: number;
  readonly answer: (asked: Asked) => Promise<Said>;
}

const verbs: Readonly<Record<string, Verb>> = {
  'grant-admin': { takes: 1, answer: ({ open, given }) => adminGrantedBy(given, open) },
  'reset-setup': { takes: 0, answer: ({ settings, open }) => setupStartedOverBy(settings, open) },
  'register-client': {
    takes: 0,
    answer: ({ settings, requests, open }) => clientRegisteredBy(settings, requests, open),
  },
  'delete-chat': { takes: 4, answer: ({ open, given }) => chatDeletedBy(given, open) },
};

function verbAsked([name = '', ...given]: readonly string[]): Verb | undefined {
  const verb = Object.hasOwn(verbs, name) ? verbs[name] : undefined;
  return verb !== undefined && given.length <= verb.takes ? verb : undefined;
}

function messageOf(failure: unknown): string {
  return String(Reflect.get(new Object(failure), 'message')).replaceAll(/\s*\n\s*/gu, ' ');
}

async function answered(verb: Verb, args: readonly string[], host: AdminHost): Promise<Said> {
  const shippedFiles = shippedFilesOnDisk(shippedRoots);
  const settings = await settingsAtStart(host.environment, shippedFiles, host.defaultIdentityProvider).catch(
    (failure: unknown) => refused(messageOf(failure)),
  );
  if ('said' in settings) {
    return settings;
  }
  const open: Opening = (use) => withTheLedgerOpened(settings, shippedFiles, use);
  const requests = host.requests ?? providerRequestsOverTheNetwork;
  return verb.answer({ settings, open, given: args.slice(1), requests });
}

function told(said: Said, { console }: AdminHost): number {
  const write = said.said === 'out' ? console.log : console.error;
  for (const line of said.lines) {
    write(line);
  }
  return said.said === 'out' ? 0 : 1;
}

export async function runAdminCommand(args: readonly string[], host: AdminHost): Promise<number> {
  const verb = verbAsked(args);
  if (verb === undefined) {
    host.console.error(noCommandIn(['admin', ...args]));
    host.console.error(host.usage);
    return 1;
  }
  return told(await answered(verb, args, host), host);
}
