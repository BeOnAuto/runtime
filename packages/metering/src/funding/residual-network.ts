interface Arc {
  readonly to: string;
  readonly cost: bigint;
  readonly available: () => bigint;
  readonly augment: (units: bigint) => void;
}

type Graph = ReadonlyMap<string, readonly Arc[]>;

function shortestPath(graph: Graph, start: string, end: string): readonly Arc[] {
  const distances = new Map<string, bigint>([[start, 0n]]);
  const previous = new Map<string, Readonly<{ from: string; arc: Arc }>>();
  const relax = (from: string, arcs: readonly Arc[]): boolean => {
    const distance = distances.get(from);
    if (distance === undefined) return false;
    let changed = false;
    for (const arc of arcs) {
      if (arc.available() === 0n) continue;
      const candidate = distance + arc.cost;
      const existing = distances.get(arc.to);
      if (existing === undefined || candidate < existing) {
        distances.set(arc.to, candidate);
        previous.set(arc.to, { from, arc });
        changed = true;
      }
    }
    return changed;
  };
  for (let step = 1; step < graph.size; step += 1) {
    let changed = false;
    for (const [from, arcs] of graph) changed = relax(from, arcs) || changed;
    if (!changed) break;
  }
  const path: Arc[] = [];
  let node = end;
  while (node !== start) {
    const step = previous.get(node);
    if (step === undefined) return [];
    path.push(step.arc);
    node = step.from;
  }
  return path;
}

export interface FundingNetwork {
  readonly connect: (from: string, to: string, capacity: bigint, cost: bigint) => () => bigint;
  readonly fill: (start: string, end: string, units: bigint) => boolean;
}

function fill(graph: Graph, start: string, end: string, units: bigint): boolean {
  let remaining = units;
  while (remaining > 0n) {
    const path = shortestPath(graph, start, end);
    if (path.length === 0) return false;
    const amount = path.reduce((smallest, arc) => (arc.available() < smallest ? arc.available() : smallest), remaining);
    for (const arc of path) arc.augment(amount);
    remaining -= amount;
  }
  return true;
}

export function fundingNetwork(): FundingNetwork {
  const graph = new Map<string, Arc[]>();
  const append = (from: string, arc: Arc): void => {
    const arcs = graph.get(from) ?? [];
    arcs.push(arc);
    graph.set(from, arcs);
  };
  const connect = (from: string, to: string, capacity: bigint, cost: bigint): (() => bigint) => {
    let forwardCapacity = capacity;
    let reverseCapacity = 0n;
    append(from, {
      to,
      cost,
      available: () => forwardCapacity,
      augment: (units) => {
        forwardCapacity -= units;
        reverseCapacity += units;
      },
    });
    append(to, {
      to: from,
      cost: -cost,
      available: () => reverseCapacity,
      augment: (units) => {
        reverseCapacity -= units;
        forwardCapacity += units;
      },
    });
    return () => capacity - forwardCapacity;
  };
  return { connect, fill: (start, end, units) => fill(graph, start, end, units) };
}
