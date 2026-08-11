// Fixture for testing find_references within the same file

export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  // Calls add() within the same class
  addThree(a: number, b: number, c: number): number {
    return this.add(this.add(a, b), c);
  }

  // Another call to add()
  double(n: number): number {
    return this.add(n, n);
  }
}

// External usage
const calc = new Calculator();
const result = calc.add(1, 2);
