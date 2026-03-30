import { contentHash } from '../../src/service.js'

describe('contentHash', () => {
  it('returns the same hash for identical content', () => {
    const a = contentHash('{"schedules":[]}')
    const b = contentHash('{"schedules":[]}')
    expect(a).toBe(b)
  })

  it('returns different hashes for different content', () => {
    const a = contentHash('{"schedules":[]}')
    const b = contentHash('{"schedules":[{"id":"abc123"}]}')
    expect(a).not.toBe(b)
  })

  it('detects single-character changes', () => {
    const a = contentHash('{"enabled":true}')
    const b = contentHash('{"enabled":false}')
    expect(a).not.toBe(b)
  })

  it('returns a string', () => {
    expect(typeof contentHash('test')).toBe('string')
  })

  it('handles empty string', () => {
    expect(contentHash('')).toBe('0')
  })
})
