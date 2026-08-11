import { User, Status, Color, Service } from "./types.js";

const user: User = { id: 1, name: "Alice" };
const status: Status = "active";
const color: Color = Color.Red;
const service: Service = new Service();

function processUser(u: User): Status {
  return "active";
}
