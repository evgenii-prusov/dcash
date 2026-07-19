import en from './en.json'
import ru from './ru.json'

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object'
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  )
}

test('en and ru catalogs have identical key sets', () => {
  expect(keys(ru).sort()).toEqual(keys(en).sort())
})

test('catalog strings are non-empty', () => {
  for (const catalog of [en, ru]) {
    for (const key of keys(catalog)) {
      const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], catalog)
      expect(value, key).toBeTruthy()
    }
  }
})
