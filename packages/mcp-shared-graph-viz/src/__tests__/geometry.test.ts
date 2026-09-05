import { describe, expect, it } from "vitest";

import {
  ARROW_LENGTH,
  arrowHeadPoints,
  boundaryPoint,
  boundsOf,
  controlPointFor,
  parallelOffset,
  quadraticPointAt,
  retractForArrow,
  selfLoopPath,
} from "../svg/geometry.js";
import type { NodeBox } from "../svg/geometry.js";

const rect: NodeBox = { x: 0, y: 0, width: 100, height: 40, shape: "roundRect" };

describe("boundaryPoint", () => {
  type Case = { name: string; box: NodeBox; toward: { x: number; y: number }; expected: { x: number; y: number } };
  const cases: Case[] = [
    { name: "rectangle, straight right", box: rect, toward: { x: 500, y: 0 }, expected: { x: 50, y: 0 } },
    { name: "rectangle, straight down", box: rect, toward: { x: 0, y: 500 }, expected: { x: 0, y: 20 } },
    { name: "rectangle, straight left", box: rect, toward: { x: -500, y: 0 }, expected: { x: -50, y: 0 } },
    {
      name: "ellipse, straight right",
      box: { ...rect, shape: "ellipse" },
      toward: { x: 500, y: 0 },
      expected: { x: 50, y: 0 },
    },
    {
      name: "ellipse, straight down",
      box: { ...rect, shape: "ellipse" },
      toward: { x: 0, y: 500 },
      expected: { x: 0, y: 20 },
    },
    {
      name: "diamond, straight right",
      box: { ...rect, shape: "diamond" },
      toward: { x: 500, y: 0 },
      expected: { x: 50, y: 0 },
    },
    {
      name: "diamond, diagonal lands on the sloped face",
      box: { ...rect, shape: "diamond" },
      toward: { x: 100, y: 100 },
      expected: { x: 14.29, y: 14.29 },
    },
  ];

  it.each(cases)("$name", ({ box, toward, expected }) => {
    const point = boundaryPoint({ box, toward });
    expect(point.x).toBeCloseTo(expected.x, 1);
    expect(point.y).toBeCloseTo(expected.y, 1);
  });

  it("returns the center when the target shares it", () => {
    expect(boundaryPoint({ box: rect, toward: { x: 0, y: 0 } })).toEqual({ x: 0, y: 0 });
  });

  it("stays on the shorter side for a diagonal on a wide rectangle", () => {
    const point = boundaryPoint({ box: rect, toward: { x: 100, y: 100 } });
    expect(point.y).toBeCloseTo(20, 5);
    expect(Math.abs(point.x)).toBeLessThanOrEqual(50);
  });
});

describe("parallelOffset", () => {
  type Case = { name: string; index: number; total: number; expected: number };
  const cases: Case[] = [
    { name: "a lone edge stays straight", index: 0, total: 1, expected: 0 },
    { name: "two edges split symmetrically (first)", index: 0, total: 2, expected: -11 },
    { name: "two edges split symmetrically (second)", index: 1, total: 2, expected: 11 },
    { name: "the middle of three stays straight", index: 1, total: 3, expected: 0 },
  ];

  it.each(cases)("$name", ({ index, total, expected }) => {
    expect(parallelOffset({ index, total })).toBeCloseTo(expected, 5);
  });
});

describe("controlPointFor", () => {
  it("returns the midpoint when there is no offset", () => {
    expect(controlPointFor({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, offset: 0 })).toEqual({
      x: 5,
      y: 0,
    });
  });

  it("displaces along the normal", () => {
    expect(controlPointFor({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, offset: 4 })).toEqual({
      x: 5,
      y: 4,
    });
  });

  it("returns the midpoint for a zero-length segment", () => {
    expect(controlPointFor({ from: { x: 3, y: 3 }, to: { x: 3, y: 3 }, offset: 8 })).toEqual({
      x: 3,
      y: 3,
    });
  });
});

describe("selfLoopPath", () => {
  it("starts and ends on the top edge, arcing above the node", () => {
    const loop = selfLoopPath({ box: rect });
    expect(loop.start.y).toBe(-20);
    expect(loop.end.y).toBe(-20);
    expect(loop.start.x).toBeLessThan(loop.end.x);
    for (const control of loop.controlPoints) {
      expect(control.y).toBeLessThan(loop.start.y);
    }
  });
});

describe("arrowHeadPoints", () => {
  it("points away from the origin", () => {
    const [tip, left, right] = arrowHeadPoints({ tip: { x: 10, y: 0 }, from: { x: 0, y: 0 } });
    expect(tip).toEqual({ x: 10, y: 0 });
    expect(left.x).toBeCloseTo(10 - ARROW_LENGTH, 5);
    expect(right.x).toBeCloseTo(10 - ARROW_LENGTH, 5);
    expect(left.y).toBeCloseTo(-right.y, 5);
  });

  it("degenerates to a point when tip and origin coincide", () => {
    const points = arrowHeadPoints({ tip: { x: 1, y: 1 }, from: { x: 1, y: 1 } });
    expect(points).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ]);
  });
});

describe("retractForArrow", () => {
  it("pulls the endpoint back along the direction of travel", () => {
    expect(retractForArrow({ tip: { x: 20, y: 0 }, from: { x: 0, y: 0 } })).toEqual({
      x: 20 - ARROW_LENGTH,
      y: 0,
    });
  });

  it("leaves a degenerate endpoint alone", () => {
    expect(retractForArrow({ tip: { x: 2, y: 2 }, from: { x: 2, y: 2 } })).toEqual({ x: 2, y: 2 });
  });
});

describe("quadraticPointAt", () => {
  type Case = { name: string; t: number; expected: { x: number; y: number } };
  const cases: Case[] = [
    { name: "t=0 is the start", t: 0, expected: { x: 0, y: 0 } },
    { name: "t=1 is the end", t: 1, expected: { x: 10, y: 0 } },
    { name: "t=0.5 is pulled toward the control point", t: 0.5, expected: { x: 5, y: 5 } },
  ];

  it.each(cases)("$name", ({ t, expected }) => {
    const point = quadraticPointAt({
      from: { x: 0, y: 0 },
      control: { x: 5, y: 10 },
      to: { x: 10, y: 0 },
      t,
    });
    expect(point.x).toBeCloseTo(expected.x, 5);
    expect(point.y).toBeCloseTo(expected.y, 5);
  });
});

describe("boundsOf", () => {
  it("covers the node boxes plus padding", () => {
    expect(boundsOf({ boxes: [rect], extraPoints: [], padding: 10 })).toEqual({
      x: -60,
      y: -30,
      width: 120,
      height: 60,
    });
  });

  it("extends to cover control points outside the nodes", () => {
    const bounds = boundsOf({ boxes: [rect], extraPoints: [{ x: 0, y: -200 }], padding: 0 });
    expect(bounds.y).toBe(-200);
  });

  it("returns a padding-sized box for an empty graph", () => {
    expect(boundsOf({ boxes: [], extraPoints: [], padding: 5 })).toEqual({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
  });
});
