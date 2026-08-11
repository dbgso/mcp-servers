// This file uses path aliases defined in tsconfig.json
// Note: This is for testing path resolution capabilities
import type { User } from "./types.js";

export function formatUser(user: User): string {
  return `${user.name} <${user.email}>`;
}
