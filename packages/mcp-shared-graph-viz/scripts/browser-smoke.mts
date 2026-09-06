/**
 * Opens every layout in a real browser and checks that it draws.
 *
 * The unit tests assert what the page *says*; this asserts that a browser can
 * act on it. Every defect found in this package so far — an extension's global
 * named wrong, a missing dependency script, a layout name cytoscape does not
 * know, a layout that spins forever — passed the unit tests and failed here.
 *
 * Run it by hand after touching a layout, a script URL, or the page template:
 *
 *   pnpm --filter mcp-shared-graph-viz smoke
 *
 * Needs Chrome and network access to the CDNs the page loads from, which is
 * why it is not part of `pnpm test`.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { layoutNames, renderGraphHtml } from "../src/index.js";
import type { LayoutName } from "../src/index.js";

/** A graph with a cycle in it, because that is what broke elk's radial. */
const NODE_COUNT = 12;
const GROUPS = ["alpha", "beta", "gamma"];

function sampleGraph(params: { positioned: boolean }) {
  const nodes = Array.from({ length: NODE_COUNT }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
    group: GROUPS[i % GROUPS.length],
    ...(params.positioned
      ? { position: { x: (i % 4) * 160, y: Math.floor(i / 4) * 120 } }
      : {}),
  }));
  const edges = [
    ...Array.from({ length: NODE_COUNT - 1 }, (_, i) => ({
      source: `n${i}`,
      target: `n${i + 1}`,
    })),
    { source: "n0", target: "n5" },
    { source: "n2", target: "n8", label: "labelled" },
  ];
  return { nodes, edges };
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "google-chrome",
  "chromium",
  "chromium-browser",
].filter((value): value is string => value !== undefined);

/** How long a single layout may take before it counts as hung. */
const LAYOUT_TIMEOUT_MS = 20_000;
const SETTLE_MS = 3_000;

interface Verdict {
  name: LayoutName;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "graph-viz-smoke-"));
  let server: Server | undefined;
  let chrome: ChildProcess | undefined;

  try {
    const names = layoutNames();
    for (const name of names) {
      const html = renderGraphHtml({
        graph: sampleGraph({ positioned: name === "preset" }),
        layout: { name, direction: "LR" },
        title: name,
      });
      await writeFile(join(dir, `${name}.html`), html, "utf-8");
    }

    server = await startServer({ dir });
    const port = (server.address() as { port: number }).port;
    chrome = await startChrome({ profileDir: join(dir, "profile") });
    const cdpPort = await readDevToolsPort({ profileDir: join(dir, "profile") });

    const verdicts: Verdict[] = [];
    for (const name of names) {
      verdicts.push(await checkLayout({ name, port, cdpPort }));
    }

    report({ verdicts });
    if (verdicts.some((v) => !v.ok)) {
      process.exitCode = 1;
    }
  } finally {
    // Chrome has to be gone before the profile directory can go: it keeps
    // writing to it, and removing it underneath gives ENOTEMPTY.
    await stopChrome({ chrome });
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    await rm(dir, { recursive: true, force: true });
  }
}

async function stopChrome(params: { chrome?: ChildProcess }): Promise<void> {
  const { chrome } = params;
  if (chrome === undefined || chrome.exitCode !== null) {
    return;
  }
  const exited = new Promise<void>((resolve) => chrome.once("exit", () => resolve()));
  chrome.kill("SIGTERM");
  await Promise.race([exited, delay(5_000).then(() => chrome.kill("SIGKILL"))]);
  await Promise.race([exited, delay(2_000)]);
}

async function startServer(params: { dir: string }): Promise<Server> {
  const { dir } = params;
  const server = createServer((req, res) => {
    // The query string is a cache-buster, not part of the filename. Forgetting
    // this once made an empty 404 page look like a page with no warnings.
    const name = (req.url ?? "/").split("?")[0].replace(/^\//, "");
    if (name === "favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    readFile(join(dir, name))
      .then((body) => {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
      });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return server;
}

async function startChrome(params: { profileDir: string }): Promise<ChildProcess> {
  const { profileDir } = params;
  const binary = CHROME_CANDIDATES.find((candidate) => canRun({ binary: candidate }));
  if (binary === undefined) {
    throw new Error(
      `No Chrome found. Tried ${CHROME_CANDIDATES.join(", ")}; set CHROME_PATH to point at one.`,
    );
  }
  return spawn(
    binary,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--window-size=1400,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
}

function canRun(params: { binary: string }): boolean {
  const { binary } = params;
  if (binary.includes("/")) {
    return existsSync(binary);
  }
  const paths = (process.env.PATH ?? "").split(":");
  return paths.some((entry) => entry !== "" && existsSync(join(entry, binary)));
}

/** Chrome writes the port it actually took into the profile directory. */
async function readDevToolsPort(params: { profileDir: string }): Promise<number> {
  const { profileDir } = params;
  const file = join(profileDir, "DevToolsActivePort");
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(250);
    try {
      const [line] = (await readFile(file, "utf-8")).split("\n");
      const port = Number.parseInt(line, 10);
      if (Number.isFinite(port) && port > 0) {
        return port;
      }
    } catch {
      // Not written yet.
    }
  }
  throw new Error("Chrome never reported a debugging port");
}

async function checkLayout(params: {
  name: LayoutName;
  port: number;
  cdpPort: number;
}): Promise<Verdict> {
  const { name, port, cdpPort } = params;
  const session = await openSession({ cdpPort });
  try {
    await session.send("Runtime.enable");
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    await session.send("Page.navigate", {
      url: `http://127.0.0.1:${port}/${name}.html?v=${Date.now()}`,
    });
    await delay(SETTLE_MS);

    const raw = await session.evaluate({
      expression: `JSON.stringify((function () {
        if (!window.graphViz) return { loaded: false };
        var ns = graphViz.cy.nodes();
        var box = ns.boundingBox();
        var positions = ns.toArray().map(function (n) { return n.position(); });
        return {
          loaded: true,
          nodes: ns.length,
          finite: positions.every(function (p) { return isFinite(p.x) && isFinite(p.y) && Math.abs(p.x) < 1e6; }),
          distinct: new Set(positions.map(function (p) { return Math.round(p.x) + "," + Math.round(p.y); })).size,
          width: Math.round(box.w),
          height: Math.round(box.h),
        };
      })())`,
    });

    if (raw === undefined) {
      // The evaluate never came back: the layout is still running and has the
      // main thread. This is the only way a hang shows up.
      return { name, ok: false, detail: "hung — the page stopped answering" };
    }

    const page = JSON.parse(raw) as {
      loaded: boolean;
      nodes?: number;
      finite?: boolean;
      distinct?: number;
      width?: number;
      height?: number;
    };
    if (!page.loaded) {
      return { name, ok: false, detail: "the page did not initialise cytoscape" };
    }
    if (session.errors.length > 0) {
      return { name, ok: false, detail: session.errors[0] };
    }
    if (page.nodes !== NODE_COUNT) {
      return { name, ok: false, detail: `drew ${page.nodes} of ${NODE_COUNT} nodes` };
    }
    if (page.finite !== true) {
      return { name, ok: false, detail: "a node landed at a non-finite position" };
    }
    if (page.distinct !== NODE_COUNT) {
      return { name, ok: false, detail: `${NODE_COUNT - (page.distinct ?? 0)} nodes share a position` };
    }
    if ((page.width ?? 0) <= 0 || (page.height ?? 0) <= 0) {
      return { name, ok: false, detail: "the graph has no extent" };
    }
    return { name, ok: true, detail: `${page.width} x ${page.height}` };
  } finally {
    session.close();
  }
}

interface Session {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  evaluate: (params: { expression: string }) => Promise<string | undefined>;
  errors: string[];
  close: () => void;
}

async function openSession(params: { cdpPort: number }): Promise<Session> {
  const { cdpPort } = params;
  const targets = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  const target = targets.find((t) => t.type === "page");
  if (target === undefined) {
    throw new Error("Chrome exposed no page to drive");
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map<number, (value: unknown) => void>();
  const errors: string[] = [];
  let nextId = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: Record<string, never>;
    };
    if (message.id !== undefined) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails as
        | { text?: string; exception?: { description?: string } }
        | undefined;
      errors.push((details?.exception?.description ?? details?.text ?? "exception").slice(0, 120));
    }
  });
  await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve()));

  const send = (method: string, methodParams: Record<string, unknown> = {}): Promise<unknown> =>
    new Promise((resolve) => {
      const id = (nextId += 1);
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params: methodParams }));
    });

  const evaluate = async (evalParams: { expression: string }): Promise<string | undefined> => {
    const answered = await Promise.race([
      send("Runtime.evaluate", { expression: evalParams.expression, returnByValue: true }),
      delay(LAYOUT_TIMEOUT_MS).then(() => undefined),
    ]);
    const result = answered as { result?: { result?: { value?: string } } } | undefined;
    return result?.result?.result?.value;
  };

  return { send, evaluate, errors, close: () => socket.close() };
}

function report(params: { verdicts: Verdict[] }): void {
  const { verdicts } = params;
  const width = Math.max(...verdicts.map((v) => v.name.length));
  console.log(`${"layout".padEnd(width)}  result`);
  console.log("-".repeat(width + 40));
  for (const verdict of verdicts) {
    console.log(`${verdict.name.padEnd(width)}  ${verdict.ok ? "ok" : "FAILED"}  ${verdict.detail}`);
  }
  const failed = verdicts.filter((v) => !v.ok).length;
  console.log("-".repeat(width + 40));
  console.log(failed === 0 ? `all ${verdicts.length} layouts drew` : `${failed} of ${verdicts.length} failed`);
}

await main();
