export interface InvitationAddress {
  readonly invitation: string;
  readonly emailAddress: string;
  readonly invitedAt: number;
}

export interface InvitationAddresses {
  readonly kept: (address: InvitationAddress) => Promise<void>;
  readonly listed: () => Promise<readonly InvitationAddress[]>;
  readonly forgotten: (invitations: readonly string[]) => Promise<void>;
}
