import { ContextReference } from '@on.auto/operations';
import { Schema } from 'effect';

import { DefaultRoleSchema, InvitationIdSchema } from '../assignments/role-assignment-facts.ts';

const ProfileFields = {
  id: Schema.String,
  name: Schema.NullOr(Schema.String),
  identifier: Schema.NullOr(Schema.String),
};

export const MemberSchema = Schema.Struct({ ...ProfileFields, role: Schema.String, joined_at: Schema.String });

export const InvitationSchema = Schema.Struct({
  id: Schema.String,
  email_address: Schema.String,
  role: Schema.String,
  status: Schema.String,
  invited_at: Schema.String,
  expires_at: Schema.NullOr(Schema.String),
});

export const InvitationMadeSchema = Schema.Struct({
  ...InvitationSchema.fields,
  link: Schema.optionalKey(Schema.String),
});

export const MembersSchema = Schema.Struct({
  members: Schema.Array(MemberSchema),
  members_total: Schema.Number,
  invitations: Schema.Array(InvitationSchema),
  invitations_total: Schema.Number,
});

export const MemberField = ContextReference.check(Schema.isMinLength(1)).annotate({
  description: 'The member’s id, as list_members answers it',
});

export const InvitationField = InvitationIdSchema.annotate({
  description: 'The invitation’s id, as list_members answers it',
});

export const invitedRoles = ['editor', 'viewer'] as const;

export const InvitedRoleField = Schema.Literals(invitedRoles).annotate({
  description: 'editor, who builds, runs and changes playbooks, or viewer, who views and comments; editor if left out',
});

export const DefaultRoleField = DefaultRoleSchema.fields.id.annotate({
  description: 'editor, who builds, runs and changes playbooks, or viewer, who views and comments',
});

export const DefaultRoleAskedField = DefaultRoleSchema.fields.id.annotate({
  description:
    'editor, who builds, runs and changes playbooks, or viewer, who views and comments; unchanged if left out',
});

const mostEmailAddressCharacters = 254;

export const EmailAddressField = Schema.String.check(
  Schema.isMaxLength(mostEmailAddressCharacters),
  Schema.isPattern(/^\S+@\S+\.\S+$/u),
).annotate({ description: 'The email address of the person to invite' });

export type Member = typeof MemberSchema.Type;

export type Invitation = typeof InvitationSchema.Type;

export type InvitationMade = typeof InvitationMadeSchema.Type;
