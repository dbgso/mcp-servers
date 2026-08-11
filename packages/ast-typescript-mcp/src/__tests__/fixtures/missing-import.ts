// Test file with missing imports
// User is defined in ./types.ts but not imported

export function createPerson(name: string, email: string): User {
  return { id: 1, name, email };
}
