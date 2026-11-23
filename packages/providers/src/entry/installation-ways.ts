import { placeholdersIn } from '@on.auto/config';
import {
  isJsonPointer,
  isPinnableUrl,
  isUnderTheIssuer,
  pinnedUrlShape,
  TokenRequestSchema,
  tokenRequestIssuesOf,
} from '@on.auto/tool-servers';
import { Schema } from 'effect';

import { AnswerConditionsSchema, noCondition } from './answer-conditions.ts';

export const installationIdPlaceholder = 'installation_id';

export const accountNamePlaceholder = 'account_name';

const notAPointer = 'Expected a JSON Pointer into the answer, such as /id';

const PointerSchema = Schema.String.check(
  Schema.makeFilter((pointer: string) => (isJsonPointer(pointer) ? undefined : notAPointer)),
);

const NamedSchema = Schema.String.check(Schema.isMinLength(1));

function conditionsIssueOf(conditions: Readonly<Record<string, unknown>>): string | undefined {
  const pointers = Object.keys(conditions);
  if (pointers.length === 0) {
    return noCondition;
  }
  return pointers.every((pointer) => isJsonPointer(pointer)) ? undefined : notAPointer;
}

const ConditionsSchema = AnswerConditionsSchema.check(
  Schema.makeFilter((conditions: Readonly<Record<string, unknown>>) => conditionsIssueOf(conditions)),
);

const everyOneHolds = 'each a JSON Pointer with the values it may equal, every one of which holds';

const InstallationsSchema = Schema.Struct({
  method: Schema.Literal('GET').annotate({ description: 'The method of the request, GET' }),
  url: Schema.String.annotate({
    description: 'The https URL, under the issuer, that lists the installations the signed-in person can reach',
  }),
  list: PointerSchema.annotate({ description: 'The JSON Pointer to the list of installations in the answer' }),
  id: PointerSchema.annotate({ description: "The JSON Pointer to an installation's ID, within each item of the list" }),
  name: PointerSchema.annotate({
    description: `The JSON Pointer to the name of the account the installation is on, within each item of the list. Auto shows it to the person, and writes it as {${accountNamePlaceholder}} in the membership request`,
  }),
  account: PointerSchema.annotate({
    description: 'The JSON Pointer to the ID of the account the installation is on, within each item of the list',
  }),
  personal: ConditionsSchema.annotate({
    description: `Conditions on each item of the list that hold only for an installation on a person's own account, not on an organization: ${everyOneHolds}`,
  }),
}).annotate({
  description:
    "The request, sent with the signed-in person's token, that lists the installations of the application the person can reach, and where its answer names each one",
});

const UserinfoSchema = Schema.Struct({
  method: Schema.Literal('GET').annotate({ description: 'The method of the request, GET' }),
  url: Schema.String.annotate({
    description: 'The https URL, under the issuer, that answers who the signed-in person is',
  }),
  id: PointerSchema.annotate({
    description:
      "The JSON Pointer to the person's ID in the answer, the ID that an installation on their own account names as its account",
  }),
}).annotate({
  description:
    "The request, sent with the signed-in person's token, that answers who they are, as the UserInfo endpoint of OpenID Connect does. Auto sends it only where an installation is on a personal account, and takes such an installation only where its account is the person's own",
});

const MembershipSchema = Schema.Struct({
  method: Schema.Literal('GET').annotate({ description: 'The method of the request, GET' }),
  url: Schema.String.annotate({
    description: `The https URL, under the issuer, that answers the signed-in person's membership of an organization. It holds {${accountNamePlaceholder}}, the name of the account an installation is on, and no other placeholder`,
  }),
  admin: ConditionsSchema.annotate({
    description: `Conditions on the answer that hold only where the person is an active admin of the organization: ${everyOneHolds}`,
  }),
}).annotate({
  description:
    "The request, sent with the signed-in person's token, that answers their membership of the organization an installation is on. Auto takes an installation on an organization only where the answer meets admin; an answer of 403 or 404 says the person is not an admin of it",
});

const ReturnedSchema = Schema.Struct({
  installation: NamedSchema.annotate({
    description: 'The query parameter the service sends the person back with after an installation, which holds its ID',
  }),
  requested: Schema.optionalKey(
    Schema.Record(NamedSchema, Schema.Array(NamedSchema).check(Schema.isMinLength(1))).annotate({
      description:
        "The query parameters, each with its values, that say the person only asked the account's owners to install the application, so nothing is installed yet",
    }),
  ),
}).annotate({ description: 'What the service sends the person back with after its installation page' });

export const InstallationSchema = Schema.Struct({
  issuer: Schema.String.annotate({
    description:
      "The https URL of the service's API that gives the application's own tokens. The requests below lie under it",
  }),
  installations: InstallationsSchema,
  userinfo: UserinfoSchema,
  membership: MembershipSchema,
  returned: ReturnedSchema,
  token_request: TokenRequestSchema.annotate({
    description: `The request that asks a token for the installation, signed with the private key of the application whoever runs Auto registered. Its URL holds {${installationIdPlaceholder}}, the ID of the installation the connection uses, and no other placeholder`,
  }),
}).annotate({
  description:
    "For authorization with application permissions, how a connection is made by installing the application whoever runs Auto registered: the person signs in at the way's issuer, Auto lists the installations they can reach and takes one only from that list, and only on an account they administer, their own or an organization they are an admin of, and asks each token for it with the application's private key",
});

export type Installation = typeof InstallationSchema.Type;

export interface InstallingWay {
  readonly kind: string;
  readonly permissions?: string | undefined;
  readonly scope?: string | undefined;
  readonly parameters?: unknown;
  readonly more?: unknown;
  readonly gateway?: unknown;
  readonly oauth_client?: string | undefined;
  readonly clients?: readonly string[] | undefined;
  readonly installation?: Installation | undefined;
}

interface WayIssue {
  readonly path: readonly string[];
  readonly issue: string;
}

const ofAnApplicationAlone =
  'Expected no installation: only an authorization way with application permissions installs an application';

const besideAnInstallation =
  'Expected no scope, parameters, more, gateway or oauth_client beside installation: the installation decides what a connection made this way reaches';

const registeredAlone =
  'Expected clients to be registered alone, or left out: a way that installs an application takes the client registered with it';

const unplacedIssuer = 'Expected the https URL of the API, or an http URL on a loopback address, with no placeholder';

const outsideTheIssuer =
  "Expected an address under the installation's issuer, with no user name or password and no placeholder";

const membershipOutsideTheIssuer = `Expected an address under the installation's issuer, with no user name or password, that holds {${accountNamePlaceholder}} and no other placeholder`;

const installationAlone = `Expected {${installationIdPlaceholder}} in the URL, and no other placeholder`;

function issueAt(path: readonly string[], issue: string): readonly WayIssue[] {
  return [{ path: ['installation', ...path], issue }];
}

function besideIssuesOf(way: InstallingWay): readonly WayIssue[] {
  const fields = ['scope', 'parameters', 'more', 'gateway', 'oauth_client'] as const;
  const given = fields
    .filter((field) => way[field] !== undefined)
    .map((field) => ({ path: [field], issue: besideAnInstallation }));
  const clients = way.clients ?? ['registered'];
  const named =
    clients.length === 1 && clients[0] === 'registered' ? [] : [{ path: ['clients'], issue: registeredAlone }];
  return [...given, ...named];
}

interface Asked {
  readonly path: readonly string[];
  readonly placeholders: readonly string[];
  readonly issue: string;
}

function holdsAlone(url: string, placeholders: readonly string[]): boolean {
  const held = placeholdersIn(url);
  return held.length === placeholders.length && held.every((name, at) => name === placeholders[at]);
}

function addressIssuesOf(issuer: string, url: string, asked: Asked): readonly WayIssue[] {
  return holdsAlone(url, asked.placeholders) && isUnderTheIssuer(issuer, url) ? [] : issueAt(asked.path, asked.issue);
}

function askedIssuesOf({ issuer, installations, userinfo, membership }: Installation): readonly WayIssue[] {
  const asked: readonly (readonly [string, Asked])[] = [
    [installations.url, { path: ['installations', 'url'], placeholders: [], issue: outsideTheIssuer }],
    [userinfo.url, { path: ['userinfo', 'url'], placeholders: [], issue: outsideTheIssuer }],
    [
      membership.url,
      { path: ['membership', 'url'], placeholders: [accountNamePlaceholder], issue: membershipOutsideTheIssuer },
    ],
  ];
  return asked.flatMap(([url, each]: readonly [string, Asked]) => addressIssuesOf(issuer, url, each));
}

function requestIssuesOf({ issuer, token_request: request }: Installation): readonly WayIssue[] {
  const held = placeholdersIn(request.url);
  const placed =
    held.length === 1 && held[0] === installationIdPlaceholder
      ? []
      : issueAt(['token_request', 'url'], installationAlone);
  const sent = tokenRequestIssuesOf(issuer, request).flatMap(({ path, issue }) =>
    issueAt(['token_request', ...path], issue),
  );
  return [...placed, ...sent];
}

function installationIssuesOf(installation: Installation): readonly WayIssue[] {
  const { issuer } = installation;
  if (!isPinnableUrl(issuer) || placeholdersIn(issuer).length > 0) {
    return issueAt(['issuer'], isPinnableUrl(issuer) ? unplacedIssuer : pinnedUrlShape);
  }
  return [...askedIssuesOf(installation), ...requestIssuesOf(installation)];
}

export function installingWayIssuesOf(way: InstallingWay): readonly WayIssue[] {
  const { installation } = way;
  if (installation === undefined) {
    return [];
  }
  if (way.kind !== 'authorization' || way.permissions !== 'application') {
    return [{ path: ['installation'], issue: ofAnApplicationAlone }];
  }
  return [...besideIssuesOf(way), ...installationIssuesOf(installation)];
}
