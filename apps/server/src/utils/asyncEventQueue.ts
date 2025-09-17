export class AsyncEventQueue<T> {
  private backlog: T[] = [];
  private resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T) {
    if (this.closed) return;
    const resolve = this.resolvers.shift();
    if (resolve) {
      resolve({ value, done: false });
      return;
    }
    this.backlog.push(value);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      resolve?.({ value: undefined as T, done: true });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.backlog.length > 0) {
      const value = this.backlog.shift()!;
      return { value, done: false };
    }

    if (this.closed) {
      return { value: undefined as T, done: true };
    }

    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }
}
