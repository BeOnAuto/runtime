export interface PersonRow {
  readonly person: string;
  readonly name?: string;
  readonly emailAddress?: string;
  readonly joinedAt: number;
  readonly updatedAt: number;
}

export type PersonSignedIn = Omit<PersonRow, 'joinedAt'>;

export interface PeopleRows {
  readonly kept: (signedIn: PersonSignedIn) => Promise<void>;
  readonly listed: () => Promise<readonly PersonRow[]>;
  readonly deleted: (person: string) => Promise<void>;
}
