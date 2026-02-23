// Fixture for type_assertion preset test
function process(obj: unknown) {
  const str = obj as string;
  const num = (obj as number) + 1;
  return str;
}
