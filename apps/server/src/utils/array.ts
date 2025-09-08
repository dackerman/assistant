export function firstOrThrow<T>(array: T[]): T {
  const first = array[0];
  if (!first) {
    throw new Error("Expected array to have at least one element");
  }
  return first;
}
