import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scheduleAutoFetch } from '../../src/renderer/src/autofetch'
import { defaultPreferences, parsePreferences } from '../../src/shared/preferences'

/** H10: autofetch cada N minutos; apagado no programa nada. */
describe('autofetch', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('apagado (0): ningún temporizador ni llamada', () => {
    const run = vi.fn()
    const stop = scheduleAutoFetch(0, run)
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(24 * 60 * 60_000)
    expect(run).not.toHaveBeenCalled()
    stop()
  })

  it('cada 5 min: llama al cumplirse cada intervalo y se detiene', () => {
    const run = vi.fn()
    const stop = scheduleAutoFetch(5, run)
    vi.advanceTimersByTime(5 * 60_000 - 1)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(10 * 60_000)
    expect(run).toHaveBeenCalledTimes(3)
    stop()
    vi.advanceTimersByTime(60 * 60_000)
    expect(run).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preferencias de antes de H10 toman 5 min; valor fuera de rango vuelve al de fábrica', () => {
    const { autoFetchMinutes: _quitado, ...antiguas } = defaultPreferences()
    expect(parsePreferences(antiguas).autoFetchMinutes).toBe(5)
    expect(parsePreferences({ ...defaultPreferences(), autoFetchMinutes: 999 }).autoFetchMinutes).toBe(5)
    expect(parsePreferences({ ...defaultPreferences(), autoFetchMinutes: 0 }).autoFetchMinutes).toBe(0)
  })
})
