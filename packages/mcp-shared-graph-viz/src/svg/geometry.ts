import type { NodeShape, Point } from "../types.js";

/**
 * Pure geometry for edge routing. Nothing here knows about cytoscape or SVG
 * syntax; it only turns node boxes and centers into points and paths.
 */

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: NodeShape;
}

export const SELF_LOOP_RADIUS = 26;
export const PARALLEL_EDGE_SPACING = 22;
export const ARROW_LENGTH = 9;
export const ARROW_HALF_WIDTH = 4.5;

/**
 * Where a ray leaving the node center crosses the node's outline.
 *
 * Edges are drawn between boundaries rather than centers so arrowheads land on
 * the shape instead of disappearing underneath it.
 */
export function boundaryPoint(params: { box: NodeBox; toward: Point }): Point {
  const { box, toward } = params;
  const dx = toward.x - box.x;
  const dy = toward.y - box.y;

  // Degenerate case: the two nodes share a center, so no direction exists.
  if (dx === 0 && dy === 0) {
    return { x: box.x, y: box.y };
  }

  if (box.shape === "ellipse") {
    return ellipseBoundary({ box, dx, dy });
  }
  if (box.shape === "diamond") {
    return diamondBoundary({ box, dx, dy });
  }
  return rectBoundary({ box, dx, dy });
}

function rectBoundary(params: { box: NodeBox; dx: number; dy: number }): Point {
  const { box, dx, dy } = params;
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  // Scale the direction vector until it touches the nearer pair of edges.
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: box.x + dx * scale, y: box.y + dy * scale };
}

function ellipseBoundary(params: { box: NodeBox; dx: number; dy: number }): Point {
  const { box, dx, dy } = params;
  const a = box.width / 2;
  const b = box.height / 2;
  const denominator = Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (b * b));
  return { x: box.x + dx / denominator, y: box.y + dy / denominator };
}

function diamondBoundary(params: { box: NodeBox; dx: number; dy: number }): Point {
  const { box, dx, dy } = params;
  const a = box.width / 2;
  const b = box.height / 2;
  // |x|/a + |y|/b = 1 describes the rhombus outline.
  const scale = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  return { x: box.x + dx * scale, y: box.y + dy * scale };
}

/**
 * Sideways offset for the n-th edge between the same pair of nodes.
 *
 * Alternates left and right of the straight line so parallel edges fan out
 * symmetrically instead of stacking on one side.
 */
export function parallelOffset(params: { index: number; total: number; spacing?: number }): number {
  const { index, total, spacing = PARALLEL_EDGE_SPACING } = params;
  if (total <= 1) {
    return 0;
  }
  const centered = index - (total - 1) / 2;
  return centered * spacing;
}

/** Midpoint of the segment, displaced along its normal by `offset`. */
export function controlPointFor(params: { from: Point; to: Point; offset: number }): Point {
  const { from, to, offset } = params;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  if (offset === 0) {
    return { x: midX, y: midY };
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return { x: midX, y: midY };
  }
  // Normal of the segment, scaled to the requested offset.
  return { x: midX - (dy / length) * offset, y: midY + (dx / length) * offset };
}

export interface SelfLoop {
  start: Point;
  end: Point;
  controlPoints: [Point, Point];
}

/** Self loops are drawn as an arc above the node, entering from the left. */
export function selfLoopPath(params: { box: NodeBox; radius?: number }): SelfLoop {
  const { box, radius = SELF_LOOP_RADIUS } = params;
  const halfWidth = box.width / 2;
  const halfHeight = box.height / 2;
  const start: Point = { x: box.x - halfWidth * 0.4, y: box.y - halfHeight };
  const end: Point = { x: box.x + halfWidth * 0.4, y: box.y - halfHeight };
  return {
    start,
    end,
    controlPoints: [
      { x: start.x - radius * 0.5, y: start.y - radius * 1.6 },
      { x: end.x + radius * 0.5, y: end.y - radius * 1.6 },
    ],
  };
}

/** Triangle for an arrowhead sitting at `tip`, pointing away from `from`. */
export function arrowHeadPoints(params: {
  tip: Point;
  from: Point;
  length?: number;
  halfWidth?: number;
}): [Point, Point, Point] {
  const { tip, from, length = ARROW_LENGTH, halfWidth = ARROW_HALF_WIDTH } = params;
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return [tip, tip, tip];
  }
  const ux = dx / distance;
  const uy = dy / distance;
  const baseX = tip.x - ux * length;
  const baseY = tip.y - uy * length;
  return [
    tip,
    { x: baseX - uy * halfWidth, y: baseY + ux * halfWidth },
    { x: baseX + uy * halfWidth, y: baseY - ux * halfWidth },
  ];
}

/** Pull the endpoint back so the line stops at the base of the arrowhead. */
export function retractForArrow(params: { tip: Point; from: Point; length?: number }): Point {
  const { tip, from, length = ARROW_LENGTH } = params;
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return tip;
  }
  return { x: tip.x - (dx / distance) * length, y: tip.y - (dy / distance) * length };
}

/** Point on a quadratic Bezier at parameter `t`, used to place edge labels. */
export function quadraticPointAt(params: {
  from: Point;
  control: Point;
  to: Point;
  t: number;
}): Point {
  const { from, control, to, t } = params;
  const inverse = 1 - t;
  return {
    x: inverse * inverse * from.x + 2 * inverse * t * control.x + t * t * to.x,
    y: inverse * inverse * from.y + 2 * inverse * t * control.y + t * t * to.y,
  };
}

export function boundsOf(params: {
  boxes: NodeBox[];
  extraPoints: Point[];
  padding: number;
}): { x: number; y: number; width: number; height: number } {
  const { boxes, extraPoints, padding } = params;
  if (boxes.length === 0 && extraPoints.length === 0) {
    return { x: 0, y: 0, width: padding * 2, height: padding * 2 };
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (const box of boxes) {
    xs.push(box.x - box.width / 2, box.x + box.width / 2);
    ys.push(box.y - box.height / 2, box.y + box.height / 2);
  }
  for (const point of extraPoints) {
    xs.push(point.x);
    ys.push(point.y);
  }

  const minX = Math.min(...xs) - padding;
  const minY = Math.min(...ys) - padding;
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) + padding - minX,
    height: Math.max(...ys) + padding - minY,
  };
}
