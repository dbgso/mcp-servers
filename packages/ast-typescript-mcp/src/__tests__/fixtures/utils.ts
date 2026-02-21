import type { User, UserId } from "./types.js";

export function createUser(id: UserId, name: string, email: string): User {
  return { id, name, email };
}

export function getUserById(users: User[], id: UserId): User | undefined {
  return users.find((user) => user.id === id);
}

export const DEFAULT_TIMEOUT = 5000;

export class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  getUser(id: UserId): User | undefined {
    return getUserById(this.users, id);
  }
}
