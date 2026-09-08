import { afterEach, describe, expect, it } from 'vitest'

// Importing the store attaches the module-level `storage`-event listener that
// mirrors localStorage-backed prefs across same-origin documents.
import { useUIStore } from '../stores/uiStore.js'

function fireStorage(key: string): void {
  window.dispatchEvent(new StorageEvent('storage', { key }))
}

afterEach(() => {
  localStorage.clear()
})

describe('uiStore cross-document storage sync', () => {
  it('mirrors langMode written by another document', () => {
    localStorage.setItem('langMode', 'zh')
    fireStorage('langMode')
    expect(useUIStore.getState().langMode).toBe('zh')

    localStorage.setItem('langMode', 'en')
    fireStorage('langMode')
    expect(useUIStore.getState().langMode).toBe('en')
  })

  it('mirrors probeMode and batteryFilterMode', () => {
    localStorage.setItem('probeMode', 'true')
    fireStorage('probeMode')
    expect(useUIStore.getState().probeMode).toBe(true)

    localStorage.setItem('batteryFilterMode', 'templates')
    fireStorage('batteryFilterMode')
    expect(useUIStore.getState().batteryFilterMode).toBe('templates')
  })

  it('ignores unrelated keys', () => {
    const before = useUIStore.getState().langMode
    localStorage.setItem('something-else', 'x')
    fireStorage('something-else')
    expect(useUIStore.getState().langMode).toBe(before)
  })
})
