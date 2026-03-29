import type { Config } from "../types/index.js";

export function createConfig(name: string): Config {
  return { name, value: 42 };
}
