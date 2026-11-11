export class StreamProjectionRefused extends Error {
  readonly projection: string;
  readonly playbook: string;

  constructor(projection: string, playbook: string) {
    super(`The rows of the read model ${projection} of ${playbook} disagree with its facts after it was built again`);
    this.name = 'StreamProjectionRefused';
    this.projection = projection;
    this.playbook = playbook;
  }
}

export function isStreamProjectionRefused(defect: unknown): defect is StreamProjectionRefused {
  return defect instanceof StreamProjectionRefused;
}
