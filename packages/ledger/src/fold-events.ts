export function foldEvents<State, Event>(
  evolve: (state: State, event: Event) => State,
  state: State,
  events: readonly Event[],
): State {
  return events.reduce((evolving, event) => evolve(evolving, event), state);
}
