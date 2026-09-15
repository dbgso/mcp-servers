export function original(value: number): number {
  return value;
}

export function caller(): number {
  const local = original(1);
  return original(local);
}
