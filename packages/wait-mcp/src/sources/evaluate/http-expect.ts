import { jsonEqual, resolveJsonPath, tryParseJson } from "./json-path.js";

export interface HttpExpectation {
  status?: number | number[];
  body_matches?: string;
  json_path?: string;
  json_equals?: unknown;
  json_matches?: string;
}

export interface ExpectationResult {
  satisfied: boolean;
  /** Conditions that are not met yet, in the order they were checked. */
  unmet: string[];
}

function statusMatches(params: { actual: number; expected: number | number[] }): boolean {
  if (Array.isArray(params.expected)) {
    return params.expected.includes(params.actual);
  }
  return params.actual === params.expected;
}

/** Value the json_* conditions apply to: the whole body, or the json_path target. */
function jsonTarget(params: { body: string; path: string | undefined }): unknown {
  const parsed = tryParseJson(params.body);
  if (params.path === undefined) {
    return parsed;
  }
  return resolveJsonPath({ value: parsed, path: params.path });
}

/** Evaluate an HTTP response against the expectation; all given conditions must hold. */
export function evaluateExpectation(params: {
  response: { status: number; body: string };
  expectation: HttpExpectation;
}): ExpectationResult {
  const { response, expectation } = params;
  const unmet: string[] = [];

  if (
    expectation.status !== undefined &&
    !statusMatches({ actual: response.status, expected: expectation.status })
  ) {
    unmet.push(`status ${response.status} != ${JSON.stringify(expectation.status)}`);
  }

  if (expectation.body_matches !== undefined && !new RegExp(expectation.body_matches).test(response.body)) {
    unmet.push(`body does not match /${expectation.body_matches}/`);
  }

  const usesJson =
    expectation.json_equals !== undefined || expectation.json_matches !== undefined;
  if (usesJson) {
    const target = jsonTarget({ body: response.body, path: expectation.json_path });

    if (expectation.json_equals !== undefined && !jsonEqual({ a: target, b: expectation.json_equals })) {
      unmet.push(
        `${expectation.json_path ?? "$"} = ${JSON.stringify(target)} != ${JSON.stringify(expectation.json_equals)}`,
      );
    }

    if (expectation.json_matches !== undefined && !new RegExp(expectation.json_matches).test(String(target))) {
      unmet.push(`${expectation.json_path ?? "$"} does not match /${expectation.json_matches}/`);
    }
  }

  return { satisfied: unmet.length === 0, unmet };
}
