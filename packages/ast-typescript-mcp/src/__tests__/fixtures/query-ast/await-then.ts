// Fixture for await_then preset test
async function fetchData() {
  // Good pattern
  const result = await fetch("/api");

  // Anti-pattern
  const data = await fetch("/api").then(r => r.json());

  return data;
}
