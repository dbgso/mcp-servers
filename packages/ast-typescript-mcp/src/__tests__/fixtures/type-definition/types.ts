export interface User {
  id: number;
  name: string;
}

export type Status = "active" | "inactive";

export enum Color {
  Red,
  Green,
  Blue,
}

export class Service {
  run(): void {}
}
