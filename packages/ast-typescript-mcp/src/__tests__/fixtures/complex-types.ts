// Test file with complex type structures for inline_type testing
import type { User, Config } from "./types.js";

// Simple type alias
export type UserId = number;

// Complex mapped type
export type ReadonlyUser = Readonly<User>;

// Pick type
export type UserBasic = Pick<User, "id" | "name">;

// Union type
export type IdOrName = number | string;

// Intersection type
export type UserWithConfig = User & Config;

// Generic type usage
export type MaybeUser = User | null;

// Function using complex types
export function processUser(user: ReadonlyUser): UserBasic {
  return { id: user.id, name: user.name };
}

// Variable with complex type
export const userConfig: UserWithConfig = {
  id: 1,
  name: "Test",
  email: "test@example.com",
  apiUrl: "https://api.example.com",
  timeout: 5000,
};
