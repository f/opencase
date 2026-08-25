import type { DesktopBounds, DesktopSize } from './types'

export type ResizeDirection =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw'

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum))

export function clampBounds(
  bounds: DesktopBounds,
  area: DesktopSize,
  minimum: DesktopSize = { width: 280, height: 180 },
): DesktopBounds {
  const areaWidth = Math.max(1, finite(area.width, 1))
  const areaHeight = Math.max(1, finite(area.height, 1))
  const minimumWidth = Math.min(areaWidth, Math.max(1, finite(minimum.width, 280)))
  const minimumHeight = Math.min(areaHeight, Math.max(1, finite(minimum.height, 180)))
  const width = clamp(finite(bounds.width, minimumWidth), minimumWidth, areaWidth)
  const height = clamp(finite(bounds.height, minimumHeight), minimumHeight, areaHeight)

  return {
    x: clamp(finite(bounds.x, 0), 0, areaWidth - width),
    y: clamp(finite(bounds.y, 0), 0, areaHeight - height),
    width,
    height,
  }
}

export function moveBounds(
  bounds: DesktopBounds,
  deltaX: number,
  deltaY: number,
  area: DesktopSize,
  minimum?: DesktopSize,
): DesktopBounds {
  return clampBounds(
    {
      ...bounds,
      x: bounds.x + finite(deltaX, 0),
      y: bounds.y + finite(deltaY, 0),
    },
    area,
    minimum,
  )
}

export function resizeBounds(
  bounds: DesktopBounds,
  deltaX: number,
  deltaY: number,
  direction: ResizeDirection,
  area: DesktopSize,
  minimum: DesktopSize = { width: 280, height: 180 },
): DesktopBounds {
  const dx = finite(deltaX, 0)
  const dy = finite(deltaY, 0)
  const movesWest = direction.includes('w')
  const movesEast = direction.includes('e')
  const movesNorth = direction.includes('n')
  const movesSouth = direction.includes('s')

  let left = bounds.x
  let top = bounds.y
  let right = bounds.x + bounds.width
  let bottom = bounds.y + bounds.height

  if (movesWest) left += dx
  if (movesEast) right += dx
  if (movesNorth) top += dy
  if (movesSouth) bottom += dy

  const minWidth = Math.min(
    Math.max(1, finite(minimum.width, 280)),
    Math.max(1, finite(area.width, 1)),
  )
  const minHeight = Math.min(
    Math.max(1, finite(minimum.height, 180)),
    Math.max(1, finite(area.height, 1)),
  )

  if (right - left < minWidth) {
    if (movesWest) left = right - minWidth
    else right = left + minWidth
  }
  if (bottom - top < minHeight) {
    if (movesNorth) top = bottom - minHeight
    else bottom = top + minHeight
  }

  left = clamp(left, 0, Math.max(0, area.width - minWidth))
  top = clamp(top, 0, Math.max(0, area.height - minHeight))
  right = clamp(right, left + minWidth, area.width)
  bottom = clamp(bottom, top + minHeight, area.height)

  return clampBounds(
    { x: left, y: top, width: right - left, height: bottom - top },
    area,
    minimum,
  )
}
