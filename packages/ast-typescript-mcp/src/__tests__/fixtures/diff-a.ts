// File A - original version for diff testing

export interface User {
  id: number;
  name: string;
}

export function createUser(id: number, name: string): User {
  return { id, name };
}

export class UserManager {
  private users: User[] = [];

  add(user: User): void {
    this.users.push(user);
  }
}

export const MAX_USERS = 100;
