// Fixture for non_null_assertion preset test
function process(obj: { name?: string }) {
  const name = obj.name!;
  const len = obj.name!.length;
  return name;
}
