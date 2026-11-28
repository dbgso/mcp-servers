// A fixture with one of every node shape the query language can navigate into.
// Each is reachable by a different arm of `getChildProperty`.
/* eslint-disable */
import { readFile } from "node:fs/promises";
import type { Stats } from "node:fs";
export { readFile as read };
export type { Stats as FileStats } from "node:fs";

interface Shape {
  size: number;
}

export class Widget {
  label: string = "widget";

  render(): string {
    return this.label;
  }
}

export function build(input: unknown, count: number = 1): Widget {
  const widget = new Widget();
  const asShape = input as Shape;
  const forced = (input as Shape)!;
  const parenthesised = (count + 1);
  const sum = count + 1;
  const chosen = count > 0 ? "many" : "one";

  if (count > 0) {
    widget.label = "several";
  } else {
    widget.label = "single";
  }

  const typed: Shape = { size: asShape.size + forced.size + parenthesised + sum };
  generic<Shape>(typed);
  widget.render();

  return chosen.length > 0 ? widget : widget;
}

export function generic<T>(value: T): T {
  return value;
}

export async function load(path: string): Promise<string> {
  const contents = await readFile(path, "utf-8");
  return contents;
}

export type Alias = Stats;
