// Fixture for instanceof preset test
function process(obj: unknown) {
  if (obj instanceof Error) {
    handleError(obj.message);
  }
  if (obj instanceof Array) {
    return obj.length;
  }
}
