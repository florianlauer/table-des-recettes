import { describe, expect, it } from 'vitest'
import {
  conflicts,
  gestureId,
  isBlocked,
  isolatedGesture,
  pageGesture,
  rowGesture,
} from './gestures'

const page = pageGesture('publish')
const otherPage = pageGesture('rescan')
const rowA = rowGesture('a', 'save')
const otherRowA = rowGesture('a', 'delete')
const rowB = rowGesture('b', 'save')
const capture = isolatedGesture('capture', 'upload')
const otherIsolated = isolatedGesture('elsewhere', 'upload')

describe('conflicts', () => {
  it('blocks one page gesture with another', () => {
    expect(conflicts(page, otherPage)).toBe(true)
  })

  it('blocks a row while a page gesture runs', () => {
    expect(conflicts(page, rowA)).toBe(true)
  })

  it('blocks a page gesture while a row runs — the reason the page lock exists', () => {
    expect(conflicts(rowA, page)).toBe(true)
  })

  it('blocks a second gesture on the same row', () => {
    expect(conflicts(rowA, otherRowA)).toBe(true)
  })

  it('leaves other rows alone', () => {
    expect(conflicts(rowA, rowB)).toBe(false)
    expect(conflicts(rowB, rowA)).toBe(false)
  })

  it('never lets an isolated gesture meet a page gesture, in either order', () => {
    expect(conflicts(capture, page)).toBe(false)
    expect(conflicts(page, capture)).toBe(false)
  })

  it('never lets an isolated gesture meet a row', () => {
    expect(conflicts(capture, rowA)).toBe(false)
    expect(conflicts(rowA, capture)).toBe(false)
  })

  it('blocks an isolated gesture only with itself', () => {
    expect(conflicts(capture, capture)).toBe(true)
    expect(conflicts(capture, otherIsolated)).toBe(false)
  })

  it('answers the same whichever way round the pair is given', () => {
    const all = [page, otherPage, rowA, otherRowA, rowB, capture, otherIsolated]
    for (const left of all)
      for (const right of all)
        expect(conflicts(left, right)).toBe(conflicts(right, left))
  })
})

describe('gestureId', () => {
  it('separates scopes, rows and actions', () => {
    const ids = new Set(
      [page, otherPage, rowA, otherRowA, rowB, capture, otherIsolated].map(
        gestureId,
      ),
    )
    expect(ids.size).toBe(7)
  })

  it('does not collide when an identifier carries the separator', () => {
    expect(gestureId(rowGesture('a:save', 'x'))).not.toBe(
      gestureId(rowGesture('a', 'save:x')),
    )
  })

  it('does not collide when an identifier carries a quote', () => {
    expect(gestureId(rowGesture('a"', 'b'))).not.toBe(
      gestureId(rowGesture('a', '"b')),
    )
  })

  it('is stable across calls', () => {
    expect(gestureId(rowGesture('a', 'save'))).toBe(
      gestureId(rowGesture('a', 'save')),
    )
  })
})

describe('isBlocked', () => {
  it('lets a row through while another row works', () => {
    expect(isBlocked([rowA], rowB)).toBe(false)
  })

  it('holds a row back as soon as one live gesture conflicts', () => {
    expect(isBlocked([rowB, page], rowA)).toBe(true)
  })

  it('lets everything through when nothing runs', () => {
    expect(isBlocked([], page)).toBe(false)
  })
})
