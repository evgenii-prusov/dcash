import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Node >=22 defines a global `localStorage` accessor that throws unless
// --localstorage-file is passed, shadowing jsdom's own implementation.
// Replace it with a plain in-memory Storage so app code relying on
// localStorage (e.g. theme persistence) works under test.
class MemoryStorage implements Storage {
  private store = new Map<string, string>()
  get length() {
    return this.store.size
  }
  clear() {
    this.store.clear()
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value))
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
})

// Import i18n dynamically so its module-scope init runs against the
// MemoryStorage patch above, not Node's throwing localStorage accessor.
const { default: i18n } = await import('../i18n')

// Tests assert English strings; reset any language a test switched to.
beforeEach(async () => {
  localStorage.clear()
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())
