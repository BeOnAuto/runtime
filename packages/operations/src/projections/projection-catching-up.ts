export class ProjectionCatchingUp extends Error {
  readonly projection: string;

  constructor(projection: string) {
    super(
      `The table of the projection ${projection} is catching up from the facts, so it is not read until it is caught up`,
    );
    this.name = 'ProjectionCatchingUp';
    this.projection = projection;
  }
}
