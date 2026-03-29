import { createUser, UserService, DEFAULT_TIMEOUT } from "./utils.js";
import type { User, Config } from "./types.js";

const config: Config = {
  apiUrl: "https://api.example.com",
  timeout: DEFAULT_TIMEOUT,
};

function main(): void {
  const service = new UserService();

  const user: User = createUser(1, "Alice", "alice@example.com");
  service.addUser(user);

  const found = service.getUser(1);
  console.log(found);
}

export { main, config };
