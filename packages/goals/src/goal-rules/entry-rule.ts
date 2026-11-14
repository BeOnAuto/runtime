export interface EntryRule {
  readonly goal: string;
  readonly each?: string;
  readonly per_id?: string;
  readonly title?: string;
  readonly link?: string;
  readonly when?: string;
  readonly marks?: string;
  readonly measures?: string;
  readonly final?: string | true;
  readonly as_of?: string;
  readonly says?: string;
}
