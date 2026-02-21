export interface User {
  id: number;
  name: string;
  email: string;
}

export type UserId = number;

export interface Config {
  apiUrl: string;
  timeout: number;
}
