import { OrgIdSchema } from '@on.auto/operations';
import { Schema } from 'effect';

export const localOrg = 'local';

export const localDeveloperId = 'local';

const refusingTheLocalOrg = Schema.makeFilter(
  (org: string) => org !== localOrg || 'This org id is reserved for local mode',
);

export const CredentialOrgSchema = OrgIdSchema.check(refusingTheLocalOrg);
