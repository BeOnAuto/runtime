import { Schema } from 'effect';

const orgIdPattern = /^[A-Za-z0-9_-]{1,64}$/u;

const playbookIdPattern = /^[a-z][a-z0-9-]{2,47}$/u;

export const OrgIdSchema = Schema.String.check(Schema.isPattern(orgIdPattern));

export const PlaybookIdSchema = Schema.String.check(Schema.isPattern(playbookIdPattern));

export function isOrgId(id: string): boolean {
  return orgIdPattern.test(id);
}

export function isPlaybookId(id: string): boolean {
  return playbookIdPattern.test(id);
}
