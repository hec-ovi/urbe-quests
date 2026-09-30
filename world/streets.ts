/**
 * Street names for a grid city. Atlas publishes streets as straight grid
 * edges with no names, and Naming names none, so a street's name is read off
 * the grid itself, the way a planned city numbers them: the lines that run
 * east and west are Streets, numbered from the north, and the lines that run
 * north and south are Avenues, numbered from the west (north is -z). One
 * name covers every edge that lies on the same line. Highways and alleys keep
 * no number. Everything is a pure function of the geometry, so every reader
 * of the same city calls a street the same.
 */

type XZ = [number, number];

/** The Atlas street geometry the names read: `streets.edges` and, optionally, `streets.nodes`. */
export interface StreetGeometry {
  edges: Array<{ id: string; class: string; path: XZ[]; level?: number }>;
}

export interface Street {
  /** Stable within a city: `street:<axis>:<ordinal>`, `highway` or `alley:<edge id>`. */
  id: string;
  /** "Third Street", "First Avenue", "the highway", "an alley". */
  name: string;
  kind: 'street' | 'avenue' | 'highway' | 'alley';
  edgeIds: string[];
}

/** Where a point is on the streets: the street it is on or beside, and the nearest corner on it. */
export interface StreetSpot {
  street: Street;
  /** Metres from the point to that street's centreline. */
  metres: number;
  /** The cross street at the nearest corner, and how far along the street that corner is. */
  cross?: Street;
  crossMetres?: number;
  /** The nearest way is an alley off `street`. */
  alley?: boolean;
}

interface Line {
  street: Street;
  /** 0 when the line runs along u (east-west), 1 along v (north-south). */
  axis: 0 | 1;
  /** Its coordinate across the axis, and its extent along it. */
  at: number;
  from: number;
  to: number;
}

const ORDINALS = [
  'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth', 'Twentieth',
];
/** Two edges this close across the axis lie on one line. */
const SAME_LINE = 3;
/** A corner further than this from the point is not "near" it. */
const CORNER_REACH = 90;

export class StreetNames {
  readonly streets: Street[] = [];
  private readonly byEdge = new Map<string, Street>();
  private readonly lines: Line[] = [];
  private readonly edges: Array<{ id: string; street: Street; path: XZ[]; ground: boolean }> = [];
  private readonly cos: number;
  private readonly sin: number;

  /** @param gridAngle the blueprint's `meta.gridAngle`, radians; the grid's first axis runs east-west */
  constructor(geometry: StreetGeometry | undefined, gridAngle = 0) {
    this.cos = Math.cos(gridAngle);
    this.sin = Math.sin(gridAngle);
    const groups = new Map<string, { axis: 0 | 1; at: number; from: number; to: number; edgeIds: string[] }>();
    const pending: Array<{ edge: StreetGeometry['edges'][number]; axis: 0 | 1; at: number; from: number; to: number }> = [];
    let highway: Street | undefined;
    for (const edge of geometry?.edges ?? []) {
      if (edge.path.length < 2) continue;
      if (edge.class === 'highway') {
        highway ??= this.add({ id: 'highway', name: 'the highway', kind: 'highway', edgeIds: [] });
        highway.edgeIds.push(edge.id);
        this.byEdge.set(edge.id, highway);
        this.edges.push({ id: edge.id, street: highway, path: edge.path, ground: false });
        continue;
      }
      if (edge.class === 'alley') {
        const alley = this.add({ id: `alley:${edge.id}`, name: 'an alley', kind: 'alley', edgeIds: [edge.id] });
        this.byEdge.set(edge.id, alley);
        this.edges.push({ id: edge.id, street: alley, path: edge.path, ground: (edge.level ?? 0) === 0 });
        continue;
      }
      const a = this.uv(edge.path[0]!);
      const b = this.uv(edge.path.at(-1)!);
      const axis: 0 | 1 = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
      const across = axis === 0 ? (a[1] + b[1]) / 2 : (a[0] + b[0]) / 2;
      pending.push({ edge, axis, at: across, from: Math.min(a[axis], b[axis]), to: Math.max(a[axis], b[axis]) });
    }
    // Edges on one line share a name: grouped by axis and their place across it.
    pending.sort((x, y) => x.axis - y.axis || x.at - y.at || x.from - y.from || x.edge.id.localeCompare(y.edge.id));
    let current: { axis: 0 | 1; at: number; from: number; to: number; edgeIds: string[] } | undefined;
    for (const item of pending) {
      if (!current || current.axis !== item.axis || Math.abs(item.at - current.at) > SAME_LINE) {
        current = { axis: item.axis, at: item.at, from: item.from, to: item.to, edgeIds: [] };
        groups.set(`${item.axis}:${groups.size}`, current);
      }
      current.edgeIds.push(item.edge.id);
      current.from = Math.min(current.from, item.from);
      current.to = Math.max(current.to, item.to);
    }
    const counts: [number, number] = [0, 0];
    for (const group of groups.values()) {
      const ordinal = counts[group.axis]++;
      const word = ORDINALS[ordinal] ?? `${ordinal + 1}${suffix(ordinal + 1)}`;
      const kind = group.axis === 0 ? 'street' : 'avenue';
      const street = this.add({ id: `${kind}:${ordinal + 1}`, name: `${word} ${kind === 'street' ? 'Street' : 'Avenue'}`, kind, edgeIds: group.edgeIds });
      this.lines.push({ street, axis: group.axis, at: group.at, from: group.from, to: group.to });
      for (const id of group.edgeIds) this.byEdge.set(id, street);
    }
    for (const item of pending) {
      this.edges.push({ id: item.edge.id, street: this.byEdge.get(item.edge.id)!, path: item.edge.path, ground: (item.edge.level ?? 0) === 0 });
    }
  }

  /** The street an Atlas street edge belongs to. */
  ofEdge(edgeId: string): Street | undefined {
    return this.byEdge.get(edgeId);
  }

  /** A street by its id. */
  byId(id: string): Street | undefined {
    return this.streets.find((street) => street.id === id);
  }

  /**
   * The grade street nearest a point, and the corner on it nearest the point;
   * `edgeId` names the street the point is known to lie on (a lot's access
   * edge), else the nearest numbered street is taken. An alley nearer than
   * any numbered street marks the spot as in an alley off it.
   */
  near(x: number, z: number, edgeId?: string): StreetSpot | undefined {
    let best: { street: Street; metres: number } | undefined;
    let alley = false;
    let nearestAlley = Infinity;
    for (const edge of this.edges) {
      if (!edge.ground) continue;
      const metres = toPath(edge.path, [x, z]);
      if (edge.street.kind === 'alley') {
        nearestAlley = Math.min(nearestAlley, metres);
        continue;
      }
      if (!best || metres < best.metres) best = { street: edge.street, metres };
    }
    const known = edgeId === undefined ? undefined : this.byEdge.get(edgeId);
    if (known && known.kind !== 'alley' && known.kind !== 'highway') {
      best = { street: known, metres: Math.min(...this.edges.filter((e) => e.street === known).map((e) => toPath(e.path, [x, z]))) };
    }
    if (!best) return undefined;
    if (nearestAlley < best.metres) alley = true;
    const spot: StreetSpot = { street: best.street, metres: best.metres, ...(alley ? { alley } : {}) };
    const corner = this.corner(best.street, x, z);
    return corner ? { ...spot, cross: corner.street, crossMetres: corner.metres } : spot;
  }

  /** The cross street whose corner with `street` lies nearest the point, within reach. */
  private corner(street: Street, x: number, z: number): { street: Street; metres: number } | undefined {
    const line = this.lines.find((candidate) => candidate.street === street);
    if (!line) return undefined;
    const [u, v] = this.uv([x, z]);
    const along = line.axis === 0 ? u : v;
    let best: { street: Street; metres: number } | undefined;
    for (const other of this.lines) {
      if (other.axis === line.axis) continue;
      // The two lines meet where each reaches the other.
      if (other.at < line.from - SAME_LINE || other.at > line.to + SAME_LINE) continue;
      if (line.at < other.from - SAME_LINE || line.at > other.to + SAME_LINE) continue;
      const metres = Math.abs(other.at - along);
      if (metres <= CORNER_REACH && (!best || metres < best.metres)) best = { street: other.street, metres };
    }
    return best;
  }

  private add(street: Street): Street {
    this.streets.push(street);
    return street;
  }

  /** A world point in grid axes: u along the first axis (east), v along the second (south). */
  private uv([x, z]: XZ): XZ {
    return [x * this.cos + z * this.sin, -x * this.sin + z * this.cos];
  }
}

function suffix(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/** Distance from a point to a polyline. */
export function toPath(path: XZ[], [x, z]: XZ): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1]!;
    const [bx, bz] = path[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const span = dx * dx + dz * dz;
    const t = span > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / span)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
  }
  return path.length === 1 ? Math.hypot(x - path[0]![0], z - path[0]![1]) : best;
}
