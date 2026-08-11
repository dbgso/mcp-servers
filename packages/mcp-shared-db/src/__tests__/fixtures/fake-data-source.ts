import { vi } from "vitest";
import type { DataSource, ExplainResult } from "../../data-source.js";

export interface FakeDataSourceHandle {
  dataSource: DataSource;
  findByPk: ReturnType<typeof vi.fn>;
  findByEq: ReturnType<typeof vi.fn>;
  findByRange: ReturnType<typeof vi.fn>;
  findByJsonPath: ReturnType<typeof vi.fn>;
  explainFindByRange: ReturnType<typeof vi.fn>;
  explainSql: ReturnType<typeof vi.fn>;
}

export interface FakeDataSourceReturns {
  findByPk?: Record<string, unknown> | null;
  findByEq?: Record<string, unknown>[];
  findByRange?: Record<string, unknown>[];
  findByJsonPath?: Record<string, unknown>[];
  explainFindByRange?: ExplainResult;
  explainSql?: ExplainResult;
}

const DEFAULT_EXPLAIN: ExplainResult = {
  estimatedRows: 0,
  totalCost: 0,
  planSummary: "(fake)",
  raw: null,
};

/**
 * Build a fake DataSource whose methods are vi.fn spies returning canned
 * values. Tests can assert that ops invoked the right method with the right
 * input shape, without needing a real engine.
 */
export function createFakeDataSource(
  returns: FakeDataSourceReturns = {},
): FakeDataSourceHandle {
  const findByPk = vi.fn().mockResolvedValue(returns.findByPk ?? null);
  const findByEq = vi.fn().mockResolvedValue(returns.findByEq ?? []);
  const findByRange = vi.fn().mockResolvedValue(returns.findByRange ?? []);
  const findByJsonPath = vi.fn().mockResolvedValue(returns.findByJsonPath ?? []);
  const explainFindByRange = vi
    .fn()
    .mockResolvedValue(returns.explainFindByRange ?? DEFAULT_EXPLAIN);
  const explainSql = vi
    .fn()
    .mockResolvedValue(returns.explainSql ?? DEFAULT_EXPLAIN);
  const dataSource: DataSource = {
    findByPk,
    findByEq,
    findByRange,
    findByJsonPath,
    explainFindByRange,
    explainSql,
  };
  return {
    dataSource,
    findByPk,
    findByEq,
    findByRange,
    findByJsonPath,
    explainFindByRange,
    explainSql,
  };
}
