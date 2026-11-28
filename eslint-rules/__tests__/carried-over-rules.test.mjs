// Tests for the rules carried over from dbgso/private-static-site.
//
// Each case is linted by the real oxlint binary with only the rule under test
// enabled, so what is checked is the rule as oxlint loads it (jsPlugins), not
// a re-implementation of the visitor. Run with `pnpm test:lint-rules`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const plugin = resolve(here, "../index.js");
const oxlint = join(repo, "node_modules/.bin/oxlint");

/**
 * Lint `code` with only `custom/<rule>` on, and return the messages it
 * reported. `filename` matters for rules that look at test files.
 */
function lint({ rule, code, options, filename = "case.ts" }) {
  const dir = mkdtempSync(join(tmpdir(), "custom-rule-"));
  try {
    const setting = options === undefined ? "error" : ["error", options];
    writeFileSync(
      join(dir, ".oxlintrc.json"),
      JSON.stringify({ jsPlugins: [plugin], categories: {}, rules: { [`custom/${rule}`]: setting } }),
    );
    writeFileSync(join(dir, filename), code);
    let out;
    try {
      out = execFileSync(oxlint, ["-c", join(dir, ".oxlintrc.json"), "--format", "json", join(dir, filename)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      // oxlint exits 1 when it reports an error; the JSON is still on stdout.
      out = err.stdout;
    }
    const { diagnostics } = JSON.parse(out);
    return diagnostics.filter((d) => d.code === `custom(${rule})`).map((d) => d.message);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function cases(rule, { valid, invalid, options, filename }) {
  for (const code of valid) {
    test(`${rule}: valid: ${code}`, () => {
      assert.deepEqual(lint({ rule, code, options, filename }), []);
    });
  }
  for (const { code, count = 1, includes } of invalid) {
    test(`${rule}: invalid: ${code}`, () => {
      const messages = lint({ rule, code, options, filename });
      assert.equal(messages.length, count, `expected ${count} report(s), got: ${JSON.stringify(messages)}`);
      if (includes) assert.ok(messages.some((m) => m.includes(includes)), JSON.stringify(messages));
    });
  }
}

// The boundary that matters most: if a future change weakens detection, the
// lint run stays green and nothing else would notice.
cases("no-secret-in-log", {
  options: { allowNames: ["tokenCount"] },
  valid: [
    "declare const config: { host: string; port: number };\nconsole.error(`connecting to ${config.host}:${config.port}`);",
    "declare const tokenCount: number;\nconsole.log(tokenCount);",
    "declare const design: string;\nconsole.log(design);",
    "declare const password: string;\nsend(password);\ndeclare function send(x: string): void;",
  ],
  invalid: [
    { code: "declare const config: { password: string };\nconsole.error(`connecting with ${config.password}`);", includes: "password" },
    { code: "declare const token: string;\nconsole.error({ token });", includes: "token" },
    { code: "declare const dsn: string;\nprocess.stderr.write(dsn);", includes: "dsn" },
    { code: "declare const connection_string: string;\nprocess.stdout.write(connection_string);", includes: "connection_string" },
    { code: "declare const dbPassword: string;\nconsole.warn('pw', dbPassword);", includes: "dbPassword" },
    { code: "declare const API_TOKEN: string;\nconsole.log(API_TOKEN);", includes: "API_TOKEN" },
  ],
});

cases("no-insecure-random", {
  valid: [
    "import { randomUUID } from 'node:crypto';\nconst id = randomUUID();",
    "const r = Math.floor(1.5);",
  ],
  invalid: [
    { code: "const id = Math.random().toString(36).slice(2);" },
    { code: "const id = globalThis.Math.random();" },
  ],
});

cases("no-focused-or-skipped-tests", {
  filename: "case.test.ts",
  options: { allowConditional: true },
  valid: [
    "declare const hasEmulator: boolean;\ndescribe.skipIf(!hasEmulator)('ssmSource', () => {});",
    "it.each([1, 2])('parses %s', () => {});",
    "it('parses', () => {});",
  ],
  invalid: [
    { code: "it.only('parses', () => {});" },
    { code: "describe.skip('helpers', () => {});" },
    { code: "it.todo('parses');" },
    { code: "it('parses', { skip: true }, () => {});" },
    { code: "it('parses', (ctx) => { ctx.skip(); });" },
  ],
});

cases("no-focused-or-skipped-tests", {
  filename: "case.test.ts",
  valid: [],
  invalid: [{ code: "declare const hasEmulator: boolean;\ndescribe.skipIf(!hasEmulator)('ssmSource', () => {});" }],
});

cases("similar-tests-each", {
  filename: "case.test.ts",
  valid: [
    "it.each([['a', 1], ['b', 2]])('parses %s', (input, want) => { expect(parse(input)).toBe(want); });",
    // Different functions are different steps.
    "it('parses a', () => { expect(parse('a')).toBe(1); });\nit('formats a', () => { expect(format('a')).toBe(1); });",
    "it('parses a', () => { expect(parse('a')).toBe(1); });",
  ],
  invalid: [
    { code: "it('parses a', () => { expect(parse('a')).toBe(1); });\nit('parses b', () => { expect(parse('b')).toBe(2); });" },
  ],
});
