// Test file with intentional type errors
export interface Person {
  name: string;
  age: number;
}

export function greet(person: Person): string {
  // Error: Property 'nme' does not exist on type 'Person'. Did you mean 'name'?
  return `Hello, ${person.nme}!`;
}

export function getAge(person: Person): string {
  // Error: Type 'number' is not assignable to type 'string'
  return person.age;
}
