import type { ServiceNamed } from '@on.auto/openid-connect/authorization-server';

export interface MemberOfAnAccount {
  readonly account: string;
  readonly member: string;
}

export interface LinkStart extends MemberOfAnAccount {
  readonly secret: string;
  readonly person?: string;
}

export interface AccountLink extends MemberOfAnAccount {
  readonly person: string;
  readonly linkedAt: number;
}

export interface AccountLinks {
  readonly started: (start: LinkStart) => Promise<void>;
  readonly startFound: (secret: string) => Promise<LinkStart | undefined>;
  readonly startOf: (member: MemberOfAnAccount) => Promise<LinkStart | undefined>;
  readonly startEnded: (start: LinkStart) => Promise<boolean>;
  readonly linked: (link: AccountLink) => Promise<void>;
  readonly linkOf: (member: MemberOfAnAccount) => Promise<AccountLink | undefined>;
  readonly personForgotten: (person: string) => Promise<void>;
}

export interface MemberNamed {
  readonly memberName: string;
  readonly accountName: string;
}

export interface NamesFromTheService {
  readonly ofTheService: (account: string) => Promise<ServiceNamed | undefined>;
  readonly ofTheMember: (member: MemberOfAnAccount) => Promise<MemberNamed | undefined>;
}
