import { describe, expect, it } from 'vitest'
import { clampBounds, moveBounds, resizeBounds } from './geometry'

const area = { width: 1_000, height: 700 }
const minimum = { width: 320, height: 220 }

describe('desktop shell geometry', () => {
  it('keeps moved windows fully inside the work area', () => {
    const start = { x: 100, y: 80, width: 500, height: 360 }
    expect(moveBounds(start, 900, 800, area, minimum)).toEqual({
      x: 500,
      y: 340,
      width: 500,
      height: 360,
    })
  })

  it('honors minimum dimensions while resizing from the north-west', () => {
    const start = { x: 120, y: 90, width: 520, height: 400 }
    expect(resizeBounds(start, 400, 350, 'nw', area, minimum)).toEqual({
      x: 320,
      y: 270,
      width: 320,
      height: 220,
    })
  })

  it('shrinks oversized restored layouts for a smaller screen', () => {
    expect(clampBounds(
      { x: 600, y: 400, width: 1_200, height: 900 },
      { width: 720, height: 520 },
      minimum,
    )).toEqual({ x: 0, y: 0, width: 720, height: 520 })
  })

  it('fails safe when persisted values are not finite', () => {
    expect(clampBounds(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY, width: 400, height: 300 },
      area,
      minimum,
    )).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })
})
