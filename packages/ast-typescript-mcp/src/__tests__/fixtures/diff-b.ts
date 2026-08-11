// File B - modified version for diff testing
// Changes:
// - User interface: removed (will show as removed)
// - createUser function: changed to arrow function (kind change -> modified)
// - UserManager class: kept same (no change)
// - MAX_USERS: removed (will show as removed)
// - NewFeature class: added (will show as added)
// - AdminUser interface: added (will show as added)

export interface AdminUser {
  id: number;
  name: string;
  role: string;
}

export const createUser = (id: number, name: string): AdminUser => {
  return { id, name, role: "user" };
};

export class UserManager {
  private users: AdminUser[] = [];

  add(user: AdminUser): void {
    this.users.push(user);
  }
}

export class NewFeature {
  execute(): void {
    console.log("new feature");
  }
}
