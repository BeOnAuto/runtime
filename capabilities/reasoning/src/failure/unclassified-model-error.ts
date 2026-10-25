export class UnclassifiedModelError extends Error {
  readonly provider: string;
  readonly kind: string;

  constructor(provider: string, kind: string) {
    super(`The call to ${provider} failed with ${kind}, which this package does not classify`);
    this.name = 'UnclassifiedModelError';
    this.provider = provider;
    this.kind = kind;
  }
}
