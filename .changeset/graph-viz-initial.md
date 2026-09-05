---
"mcp-shared-graph-viz": minor
---

Add mcp-shared-graph-viz: hand it nodes and edges, get a diagram. Mapping a domain onto nodes and edges stays with the caller; the library holds no domain knowledge.

cytoscape is used purely as a layout engine — its rendering needs a canvas and does not work headless — and the SVG is generated here, so the only runtime dependencies are `cytoscape` and `cytoscape-dagre`. Outputs are a self-contained SVG, an interactive HTML page, positions only, or raw cytoscape elements.

The library absorbs the headless pitfalls callers would otherwise hit: `boundingBox` is supplied only to layouts that need it (without it `breadthfirst` produces ~1e49 coordinates; with it `dagre` and `cose` get their spacing overwritten and nodes overlap), `preset` positions are passed to the layout explicitly because element positions are ignored headless, and the cytoscape instance is always destroyed so the Node process can exit.
