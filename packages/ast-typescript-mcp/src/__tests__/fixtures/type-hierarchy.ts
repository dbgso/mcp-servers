/**
 * Fixture for testing type hierarchy functionality.
 * Contains class inheritance (extends) and interface implementation (implements).
 */

// Base interface
export interface Animal {
  name: string;
  speak(): string;
}

// Extended interface
export interface Pet extends Animal {
  owner: string;
}

// Base class
export class Creature {
  protected energy: number = 100;

  rest(): void {
    this.energy = 100;
  }
}

// Class extending Creature and implementing Animal
export class Dog extends Creature implements Animal {
  name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  speak(): string {
    return "Woof!";
  }
}

// Class extending Dog and implementing Pet
export class PetDog extends Dog implements Pet {
  owner: string;

  constructor(name: string, owner: string) {
    super(name);
    this.owner = owner;
  }
}

// Another class extending Creature
export class Cat extends Creature implements Animal {
  name: string;

  constructor(name: string) {
    super();
    this.name = name;
  }

  speak(): string {
    return "Meow!";
  }
}

// Interface for testing multiple inheritance
export interface Walkable {
  walk(): void;
}

// Class implementing multiple interfaces
export class Robot implements Animal, Walkable {
  name: string = "Robot";

  speak(): string {
    return "Beep!";
  }

  walk(): void {
    // Robot walking
  }
}
