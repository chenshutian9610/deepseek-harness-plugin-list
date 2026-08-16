export interface MemoryStorage extends Storage {
  snapshot(): Record<string, string>
}

export function installMemoryStorage(): MemoryStorage {
  const values = new Map<string, string>()
  const storage: MemoryStorage = {
    get length() { return values.size },
    clear: () => { values.clear() },
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
    snapshot: () => Object.fromEntries(values),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  return storage
}
