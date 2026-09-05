import { estimateTextWidth, LINE_HEIGHT_RATIO } from "../measure.js";
import { resolveTheme } from "../theme.js";
import type { ResolvedTheme } from "../theme.js";
import { escapeXml, num } from "./escape.js";
import { arrowHeadPoints, quadraticPointAt, retractForArrow } from "./geometry.js";
import type {
  LaidOutEdge,
  LaidOutGraph,
  LaidOutNode,
  MeasureLabel,
  Point,
  RenderOptions,
  Swatch,
} from "../types.js";

export const DEFAULT_PADDING = 24;
export const TITLE_GAP = 16;
export const LEGEND_GAP = 18;
export const LEGEND_ROW_HEIGHT = 22;
export const LEGEND_SWATCH_SIZE = 12;
export const LEGEND_ITEM_GAP = 20;
export const EDGE_LABEL_OFFSET = 4;

export interface SvgLayoutMetrics {
  width: number;
  height: number;
  titleHeight: number;
  legendHeight: number;
  offsetX: number;
  offsetY: number;
}

export function computeSvgMetrics(params: {
  graph: LaidOutGraph;
  padding: number;
  titleHeight: number;
  legendHeight: number;
}): SvgLayoutMetrics {
  const { graph, padding, titleHeight, legendHeight } = params;
  return {
    width: graph.bounds.width + padding * 2,
    height: graph.bounds.height + padding * 2 + titleHeight + legendHeight,
    titleHeight,
    legendHeight,
    offsetX: padding - graph.bounds.x,
    offsetY: padding + titleHeight - graph.bounds.y,
  };
}

export function shouldDrawLegend(params: { graph: LaidOutGraph; legend?: boolean }): boolean {
  const { graph, legend } = params;
  if (graph.groups.length === 0) {
    return false;
  }
  return legend ?? true;
}

/** Legend entries wrapped into rows that fit the available width. */
export function layoutLegendRows(params: {
  labels: string[];
  availableWidth: number;
  fontSize: number;
  measure: MeasureLabel;
}): string[][] {
  const { labels, availableWidth, fontSize, measure } = params;
  const rows: string[][] = [];
  let current: string[] = [];
  let used = 0;

  for (const label of labels) {
    const itemWidth =
      LEGEND_SWATCH_SIZE + 6 + measure({ text: label, fontSize }) + LEGEND_ITEM_GAP;
    if (current.length > 0 && used + itemWidth > availableWidth) {
      rows.push(current);
      current = [];
      used = 0;
    }
    current.push(label);
    used += itemWidth;
  }
  if (current.length > 0) {
    rows.push(current);
  }
  return rows;
}

function nodeShapeMarkup(params: { node: LaidOutNode; theme: ResolvedTheme }): string {
  const { node } = params;
  const left = node.x - node.width / 2;
  const top = node.y - node.height / 2;
  const style = `fill="${node.swatch.fill}" stroke="${node.swatch.stroke}" stroke-width="1.5"`;

  if (node.shape === "ellipse") {
    return `<ellipse cx="${num({ value: node.x })}" cy="${num({ value: node.y })}" rx="${num({ value: node.width / 2 })}" ry="${num({ value: node.height / 2 })}" ${style} />`;
  }
  if (node.shape === "diamond") {
    const points = [
      `${num({ value: node.x })},${num({ value: top })}`,
      `${num({ value: left + node.width })},${num({ value: node.y })}`,
      `${num({ value: node.x })},${num({ value: top + node.height })}`,
      `${num({ value: left })},${num({ value: node.y })}`,
    ].join(" ");
    return `<polygon points="${points}" ${style} />`;
  }

  const radius = node.shape === "rect" ? 0 : 6;
  return `<rect x="${num({ value: left })}" y="${num({ value: top })}" width="${num({ value: node.width })}" height="${num({ value: node.height })}" rx="${radius}" ry="${radius}" ${style} />`;
}

function nodeLabelMarkup(params: { node: LaidOutNode; theme: ResolvedTheme }): string {
  const { node, theme } = params;
  const lineHeight = theme.fontSize * LINE_HEIGHT_RATIO;
  // Center the block of lines vertically on the node.
  const firstBaseline = node.y - ((node.lines.length - 1) * lineHeight) / 2;

  const tspans = node.lines
    .map((line, index) => {
      const y = firstBaseline + index * lineHeight;
      return `<tspan x="${num({ value: node.x })}" y="${num({ value: y })}">${escapeXml({ text: line })}</tspan>`;
    })
    .join("");

  return `<text text-anchor="middle" dominant-baseline="central" fill="${node.swatch.text}" font-size="${theme.fontSize}">${tspans}</text>`;
}

export function renderNode(params: { node: LaidOutNode; theme: ResolvedTheme }): string {
  const { node, theme } = params;
  const parts = [nodeShapeMarkup({ node, theme }), nodeLabelMarkup({ node, theme })];
  if (node.tooltip !== undefined) {
    parts.unshift(`<title>${escapeXml({ text: node.tooltip })}</title>`);
  }
  const body = `<g data-node-id="${escapeXml({ text: node.id })}">${parts.join("")}</g>`;
  if (node.href === undefined) {
    return body;
  }
  return `<a href="${escapeXml({ text: node.href })}" target="_blank">${body}</a>`;
}

export function edgePathData(params: { edge: LaidOutEdge; end: Point }): string {
  const { edge, end } = params;
  const start = edge.sourcePoint;
  const move = `M ${num({ value: start.x })} ${num({ value: start.y })}`;

  if (edge.controlPoints.length === 2) {
    const [first, second] = edge.controlPoints;
    return `${move} C ${num({ value: first.x })} ${num({ value: first.y })} ${num({ value: second.x })} ${num({ value: second.y })} ${num({ value: end.x })} ${num({ value: end.y })}`;
  }
  if (edge.controlPoints.length === 1) {
    const [control] = edge.controlPoints;
    return `${move} Q ${num({ value: control.x })} ${num({ value: control.y })} ${num({ value: end.x })} ${num({ value: end.y })}`;
  }
  return `${move} L ${num({ value: end.x })} ${num({ value: end.y })}`;
}

/** The point the arrowhead should point away from, for correct orientation. */
export function arrowOrigin(params: { edge: LaidOutEdge }): Point {
  const { edge } = params;
  if (edge.controlPoints.length > 0) {
    return edge.controlPoints[edge.controlPoints.length - 1];
  }
  return edge.sourcePoint;
}

export function edgeLabelPosition(params: { edge: LaidOutEdge }): Point {
  const { edge } = params;
  if (edge.controlPoints.length === 0) {
    return {
      x: (edge.sourcePoint.x + edge.targetPoint.x) / 2,
      y: (edge.sourcePoint.y + edge.targetPoint.y) / 2,
    };
  }
  return quadraticPointAt({
    from: edge.sourcePoint,
    control: edge.controlPoints[0],
    to: edge.targetPoint,
    t: 0.5,
  });
}

export function renderEdge(params: {
  edge: LaidOutEdge;
  theme: ResolvedTheme;
  color: string;
}): string {
  const { edge, theme, color } = params;
  const origin = arrowOrigin({ edge });
  const end = edge.directed
    ? retractForArrow({ tip: edge.targetPoint, from: origin })
    : edge.targetPoint;

  const parts = [
    `<path d="${edgePathData({ edge, end })}" fill="none" stroke="${color}" stroke-width="1.4" />`,
  ];

  if (edge.directed) {
    const points = arrowHeadPoints({ tip: edge.targetPoint, from: origin })
      .map((point) => `${num({ value: point.x })},${num({ value: point.y })}`)
      .join(" ");
    parts.push(`<polygon points="${points}" fill="${color}" />`);
  }

  if (edge.label !== undefined) {
    const position = edgeLabelPosition({ edge });
    const labelFontSize = theme.fontSize - 2;
    const width = estimateTextWidth({ text: edge.label, fontSize: labelFontSize });
    parts.push(
      `<rect x="${num({ value: position.x - width / 2 - 3 })}" y="${num({ value: position.y - labelFontSize / 2 - EDGE_LABEL_OFFSET })}" width="${num({ value: width + 6 })}" height="${num({ value: labelFontSize + EDGE_LABEL_OFFSET * 2 })}" rx="3" fill="${theme.palette.background}" opacity="0.85" />`,
      `<text x="${num({ value: position.x })}" y="${num({ value: position.y })}" text-anchor="middle" dominant-baseline="central" fill="${theme.palette.mutedForeground}" font-size="${labelFontSize}">${escapeXml({ text: edge.label })}</text>`,
    );
  }

  return `<g data-edge-id="${escapeXml({ text: edge.id })}">${parts.join("")}</g>`;
}

function renderLegend(params: {
  groups: { name: string; swatch: Swatch }[];
  rows: string[][];
  swatchByName: Map<string, Swatch>;
  theme: ResolvedTheme;
  x: number;
  y: number;
  measure: MeasureLabel;
}): string {
  const { rows, swatchByName, theme, x, y, measure } = params;
  const items: string[] = [];

  for (const [rowIndex, row] of rows.entries()) {
    let cursor = x;
    const rowY = y + rowIndex * LEGEND_ROW_HEIGHT;
    for (const label of row) {
      const swatch = swatchByName.get(label);
      /* c8 ignore next 3 -- rows are built from the same group list */
      if (swatch === undefined) {
        continue;
      }
      items.push(
        `<rect x="${num({ value: cursor })}" y="${num({ value: rowY - LEGEND_SWATCH_SIZE / 2 })}" width="${LEGEND_SWATCH_SIZE}" height="${LEGEND_SWATCH_SIZE}" rx="3" fill="${swatch.fill}" stroke="${swatch.stroke}" />`,
        `<text x="${num({ value: cursor + LEGEND_SWATCH_SIZE + 6 })}" y="${num({ value: rowY })}" dominant-baseline="central" fill="${theme.palette.mutedForeground}" font-size="${theme.fontSize - 1}">${escapeXml({ text: label })}</text>`,
      );
      cursor +=
        LEGEND_SWATCH_SIZE + 6 + measure({ text: label, fontSize: theme.fontSize - 1 }) + LEGEND_ITEM_GAP;
    }
  }

  return items.join("");
}

/** Turn a laid-out graph into a self-contained SVG document. */
export function renderSvg(params: { graph: LaidOutGraph } & RenderOptions): string {
  const { graph, padding = DEFAULT_PADDING, title, legend, measureLabel } = params;
  const theme = resolveTheme({ theme: params.theme });
  const measure = measureLabel ?? estimateTextWidth;

  const titleHeight = title === undefined ? 0 : theme.fontSize * 1.6 + TITLE_GAP;
  const withLegend = shouldDrawLegend({ graph, legend });
  const legendRows = withLegend
    ? layoutLegendRows({
        labels: graph.groups.map((group) => group.name),
        availableWidth: Math.max(graph.bounds.width, 240),
        fontSize: theme.fontSize - 1,
        measure,
      })
    : [];
  const legendHeight = legendRows.length === 0 ? 0 : legendRows.length * LEGEND_ROW_HEIGHT + LEGEND_GAP;

  const metrics = computeSvgMetrics({ graph, padding, titleHeight, legendHeight });

  const background = theme.drawBackground
    ? `<rect width="100%" height="100%" fill="${theme.palette.background}" />`
    : "";

  const titleMarkup =
    title === undefined
      ? ""
      : `<text x="${padding}" y="${num({ value: padding + theme.fontSize })}" fill="${theme.palette.foreground}" font-size="${num({ value: theme.fontSize * 1.25 })}" font-weight="600">${escapeXml({ text: title })}</text>`;

  const edges = graph.edges
    .map((edge) => renderEdge({ edge, theme, color: theme.palette.edge }))
    .join("");
  const nodes = graph.nodes.map((node) => renderNode({ node, theme })).join("");

  const legendMarkup =
    legendRows.length === 0
      ? ""
      : renderLegend({
          groups: graph.groups,
          rows: legendRows,
          swatchByName: new Map(graph.groups.map((group) => [group.name, group.swatch])),
          theme,
          x: padding,
          y: metrics.height - legendHeight + LEGEND_GAP / 2,
          measure,
        });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${num({ value: metrics.width })}" height="${num({ value: metrics.height })}" viewBox="0 0 ${num({ value: metrics.width })} ${num({ value: metrics.height })}" font-family="${escapeXml({ text: theme.fontFamily })}">`,
    background,
    titleMarkup,
    `<g transform="translate(${num({ value: metrics.offsetX })} ${num({ value: metrics.offsetY })})">`,
    edges,
    nodes,
    "</g>",
    legendMarkup,
    "</svg>",
  ].join("");
}
