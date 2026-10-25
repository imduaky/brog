/** Minimal LRU cache on top of Map's insertion order. */
export class LRU<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v !== undefined) {
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }

  set(key: K, value: V) {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K)
  }

  clear() {
    this.map.clear()
  }
}
