# mcp-shared-graph-viz

## 0.2.0

### Minor Changes

- 474cf6d: Add mcp-shared-graph-viz: hand it nodes and edges, get an interactive page. Mapping a domain onto nodes and edges stays with the caller; the library holds no domain knowledge.

  The page runs cytoscape in the browser, where cytoscape can both lay out and draw a graph and can measure its own text. Doing it headless would mean computing coordinates in Node and drawing them by hand, guessing node sizes from the label because there is no canvas to measure with. Keeping it in the browser avoids that and leaves the package with no runtime dependencies.

  Panning, zooming, neighbourhood highlighting on hover, click-through on nodes that carry an href, and a legend of the groups. `window.graphViz.cy` exposes the cytoscape instance so the page can be extended.
