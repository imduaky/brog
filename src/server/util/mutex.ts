/** A FIFO async lock. All operations that touch the workspace or move refs go through one. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const result = this.tail.then(fn)
    this.tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
