type Point = readonly [number, number];
type Curve = readonly [Point, Point, Point];
interface Path { start: Point; curves: readonly Curve[] }

// The supplied SVG's four cubic segments, including circle B's reversed winding.
const circleA: Path = { start: [12, 8], curves: [
  [[14.21, 8], [16, 9.79], [16, 12]], [[16, 14.21], [14.21, 16], [12, 16]],
  [[9.79, 16], [8, 14.21], [8, 12]], [[8, 9.79], [9.79, 8], [12, 8]],
] };
const infinity: Path = { start: [12, 12], curves: [
  [[14, 8.5], [19, 8.5], [19, 12]], [[19, 15.5], [14, 15.5], [12, 12]],
  [[10, 8.5], [5, 8.5], [5, 12]], [[5, 15.5], [10, 15.5], [12, 12]],
] };
const circleB: Path = { start: [12, 16], curves: [
  [[14.21, 16], [16, 14.21], [16, 12]], [[16, 9.79], [14.21, 8], [12, 8]],
  [[9.79, 8], [8, 9.79], [8, 12]], [[8, 14.21], [9.79, 16], [12, 16]],
] };
const paths = [circleA, infinity, circleB, infinity, circleA];
export const morphingInfinity = { duration: 5000, frameMs: 40, columns: 4, width: 64, height: 32 };

function easeInOut(progress: number): number {
  if (progress === 0 || progress === 1) return progress;
  // Solve cubic-bezier(0.42, 0, 0.58, 1) for the elapsed-time coordinate.
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const t = (low + high) / 2, u = 1 - t;
    const x = 3 * 0.42 * u * u * t + 3 * 0.58 * u * t * t + t * t * t;
    if (x < progress) low = t; else high = t;
  }
  const t = (low + high) / 2;
  return t * t * (3 - 2 * t);
}

export function morphingPath(elapsed: number): Point[] {
  const phase = (Math.max(0, elapsed) % morphingInfinity.duration) / (morphingInfinity.duration / 4);
  const index = Math.floor(phase), mix = easeInOut(phase - index);
  const from = paths[index] ?? circleA, to = paths[index + 1] ?? circleA;
  const blend = (a: Point, b: Point): Point => [a[0] + (b[0] - a[0]) * mix, a[1] + (b[1] - a[1]) * mix];
  let start = blend(from.start, to.start);
  const points = [start];
  from.curves.forEach((curve, curveIndex) => {
    const next = to.curves[curveIndex] ?? curve;
    const a = blend(curve[0], next[0]), b = blend(curve[1], next[1]), end = blend(curve[2], next[2]);
    for (let sample = 1; sample <= 24; sample++) {
      const t = sample / 24, u = 1 - t;
      const coordinate = (axis: 0 | 1) => u ** 3 * start[axis] + 3 * u * u * t * a[axis] + 3 * u * t * t * b[axis] + t ** 3 * end[axis];
      points.push([coordinate(0), coordinate(1)]);
    }
    start = end;
  });
  return points;
}

/** Antialiased stroke coverage, cropping only the SVG's unused vertical margins. */
export function rasterMorph(elapsed: number, width = morphingInfinity.width, height = morphingInfinity.height): Uint8Array {
  const coverage = new Uint8Array(width * height);
  const scale = width / 24, radius = 0.75 * scale;
  const points = morphingPath(elapsed).map(([x, y]) => [x * scale, (y - 6) * height / 12] as const);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (!a || !b) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
    const left = Math.max(0, Math.floor(Math.min(a[0], b[0]) - radius - 0.5));
    const right = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0]) + radius + 0.5));
    const top = Math.max(0, Math.floor(Math.min(a[1], b[1]) - radius - 0.5));
    const bottom = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1]) + radius + 0.5));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x + 0.5 - a[0]) * dx + (y + 0.5 - a[1]) * dy) / length));
      const distance = Math.hypot(x + 0.5 - a[0] - t * dx, y + 0.5 - a[1] - t * dy);
      const alpha = Math.round(255 * Math.max(0, Math.min(1, radius + 0.5 - distance)));
      const offset = y * width + x;
      coverage[offset] = Math.max(coverage[offset] ?? 0, alpha);
    }
  }
  return coverage;
}

export function brailleMorph(elapsed: number): string {
  const width = morphingInfinity.columns * 2, coverage = rasterMorph(elapsed, width, 4);
  const bits = [[0, 3], [1, 4], [2, 5], [6, 7]];
  return Array.from({ length: morphingInfinity.columns }, (_, column) => {
    let mask = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) {
      if ((coverage[y * width + column * 2 + x] ?? 0) >= 48) mask |= 1 << (bits[y]?.[x] ?? 0);
    }
    return String.fromCodePoint(0x2800 + mask);
  }).join("");
}
