import { describe, expect, it } from "vitest";
import { checkFilePath, checkHttpUrl, isInside, loadAccessPolicy, type AccessPolicy } from "../policy.js";
import { fileSource } from "../sources/file.js";
import { httpSource } from "../sources/http.js";
import { ManualClock } from "../watch/clock.js";
import { WatchManager } from "../watch/manager.js";
import { createFakeDeps } from "./helpers.js";

const strict: AccessPolicy = {
  httpHosts: ["api.example.com", "*.ci.example.com"],
  fileRoots: ["/work/project"],
  returnHttpBody: false,
  cwd: "/work/project",
};

function envOf(values: Record<string, string>) {
  return (name: string) => values[name];
}

describe("loadAccessPolicy", () => {
  it("closes http and limits files to the working directory by default", () => {
    const policy = loadAccessPolicy({ env: envOf({}), cwd: "/work/project" });
    expect(policy).toEqual({ httpHosts: [], fileRoots: ["/work/project"], returnHttpBody: false, cwd: "/work/project" });
  });

  it("reads the lists and the body opt-in from the environment", () => {
    const policy = loadAccessPolicy({
      env: envOf({
        WAIT_MCP_HTTP_ALLOW_HOSTS: " API.example.com, *.ci.example.com ,",
        WAIT_MCP_FILE_ROOTS: "logs, /var/tmp/builds",
        WAIT_MCP_HTTP_RETURN_BODY: "true",
      }),
      cwd: "/work/project",
    });
    expect(policy.httpHosts).toEqual(["api.example.com", "*.ci.example.com"]);
    expect(policy.fileRoots).toEqual(["/work/project/logs", "/var/tmp/builds"]);
    expect(policy.returnHttpBody).toBe(true);
  });
});

describe("checkHttpUrl", () => {
  it.each(["https://api.example.com/healthz", "http://build.ci.example.com:8080/x", "https://API.EXAMPLE.COM/"])(
    "allows %s",
    (url) => {
      expect(() => checkHttpUrl({ policy: strict, url })).not.toThrow();
    },
  );

  it.each([
    ["http://169.254.169.254/latest/meta-data/", /host "169.254.169.254" is not allowed/],
    ["https://ci.example.com/", /not allowed/],
    ["https://evil.com/?api.example.com", /not allowed/],
    ["file:///etc/passwd", /only http and https/],
    ["not a url", /not a valid URL/],
  ])("refuses %s", (url, message) => {
    expect(() => checkHttpUrl({ policy: strict, url })).toThrow(message);
  });

  it("says how to open http when no host is allowed", () => {
    expect(() => checkHttpUrl({ policy: { ...strict, httpHosts: [] }, url: "https://api.example.com" })).toThrow(
      /WAIT_MCP_HTTP_ALLOW_HOSTS/,
    );
  });

  it("allows any host with *", () => {
    expect(() => checkHttpUrl({ policy: { ...strict, httpHosts: ["*"] }, url: "https://anything.test" })).not.toThrow();
  });
});

describe("checkFilePath", () => {
  it.each([
    ["build.log", "/work/project/build.log"],
    ["./tmp/../out/report.json", "/work/project/out/report.json"],
    ["/work/project", "/work/project"],
  ])("resolves %s inside the root", (file, want) => {
    expect(checkFilePath({ policy: strict, file })).toBe(want);
  });

  it.each(["../secrets.env", "/etc/passwd", "/work/project-other/x"])("refuses %s", (file) => {
    expect(() => checkFilePath({ policy: strict, file })).toThrow(/outside the directories/);
  });

  it("treats a sibling with the same prefix as outside", () => {
    expect(isInside({ root: "/work/project", target: "/work/projectx" })).toBe(false);
  });
});

describe("the policy at the sources", () => {
  function strictManager() {
    return new WatchManager({ clock: new ManualClock(), deps: createFakeDeps({ policy: strict }) });
  }

  it("refuses an http watch on a host that is not allowed when it is created", () => {
    expect(() =>
      strictManager().create({ source: "http", config: { url: "http://169.254.169.254/", expect: { status: 200 } } }),
    ).toThrow(/Refused for source "http": host "169.254.169.254" is not allowed/);
  });

  it("refuses a file watch outside the roots when it is created, and in a one-off check", async () => {
    const manager = strictManager();
    expect(() => manager.create({ source: "file", config: { path: "/etc/passwd" } })).toThrow(/Refused for source "file"/);
    await expect(manager.checkOnce({ source: "file", config: { path: "/etc/passwd" } })).rejects.toThrow(
      /outside the directories/,
    );
  });

  it("refuses a Slack token_env that is not SLACK_*", () => {
    expect(() => strictManager().create({ source: "slack", config: { channel: "C1", token_env: "GITHUB_TOKEN" } })).toThrow(
      /must be an environment variable named SLACK_\*/,
    );
  });

  it("refuses a symlink inside a root that resolves outside it", async () => {
    const deps = createFakeDeps({
      policy: strict,
      files: { "/work/project/link": { stat: { mtimeMs: 1, size: 1 }, content: "x" } },
    });
    deps.realPath = async (path) => (path === "/work/project/link" ? "/etc/shadow" : path);
    await expect(
      fileSource.poll({ config: { path: "link", until: "exists" }, state: undefined, deps }),
    ).rejects.toThrow(/resolves to "\/etc\/shadow"/);
  });

  it("reads a file inside the root by its resolved path", async () => {
    const deps = createFakeDeps({
      policy: strict,
      files: { "/work/project/build.log": { stat: { mtimeMs: 1, size: 13 }, content: "BUILD SUCCESS" } },
    });
    const outcome = await fileSource.poll({
      config: { path: "build.log", until: "matches", pattern: "SUCCESS" },
      state: undefined,
      deps,
    });
    expect(outcome.satisfied).toBe(true);
  });

  it.each([
    [false, undefined],
    [true, "ok"],
  ])("returns the http body only when opted in (returnHttpBody=%s)", async (returnHttpBody, body) => {
    const deps = createFakeDeps({
      policy: { ...strict, returnHttpBody },
      httpRequest: () => ({ status: 200, body: "ok" }),
    });
    const outcome = await httpSource.poll({
      config: { url: "https://api.example.com/healthz", expect: { status: 200 } },
      state: undefined,
      deps,
    });
    expect((outcome.details as { body?: string }).body).toBe(body);
  });

  it("refuses at poll time too, for a policy that changed after the watch was made", async () => {
    const deps = createFakeDeps({ policy: { ...strict, httpHosts: [] } });
    await expect(
      httpSource.poll({ config: { url: "https://api.example.com/", expect: { status: 200 } }, state: undefined, deps }),
    ).rejects.toThrow(/No host is allowed/);
  });
});
