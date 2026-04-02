import { MR_URL_PATTERN, PR_URL_PATTERN, buildRateLimitWarning, getStatusMessage, _setLastRateLimits } from '../../src/agent.js'

describe('MR_URL_PATTERN', () => {
  it('matches /ops group MR URL', () => {
    expect(MR_URL_PATTERN.test('https://dcl.tools/ops/infra/deploy/-/merge_requests/42')).toBe(true)
  })

  it('matches /dcl group MR URL', () => {
    expect(MR_URL_PATTERN.test('https://dcl.tools/dcl/some-project/-/merge_requests/7')).toBe(true)
  })

  it('matches nested subgroup MR URL', () => {
    expect(MR_URL_PATTERN.test('https://dcl.tools/ops/team/backend/service/-/merge_requests/100')).toBe(true)
  })

  it('does not match GitHub PR URL', () => {
    expect(MR_URL_PATTERN.test('https://github.com/decentraland/repo/pull/5')).toBe(false)
  })

  it('does not match unrelated dcl.tools path', () => {
    expect(MR_URL_PATTERN.test('https://dcl.tools/ops/project/-/issues/10')).toBe(false)
  })

  it('does not match unknown group', () => {
    expect(MR_URL_PATTERN.test('https://dcl.tools/other/project/-/merge_requests/1')).toBe(false)
  })
})

describe('PR_URL_PATTERN', () => {
  it('matches GitHub PR URL', () => {
    expect(PR_URL_PATTERN.test('https://github.com/decentraland/repo/pull/123')).toBe(true)
  })

  it('does not match GitLab MR URL', () => {
    expect(PR_URL_PATTERN.test('https://dcl.tools/ops/project/-/merge_requests/1')).toBe(false)
  })
})

describe('buildRateLimitWarning', () => {
  afterEach(() => {
    _setLastRateLimits(null)
  })

  it('returns null when no rate limits are captured', () => {
    expect(buildRateLimitWarning()).toBeNull()
  })

  it('returns null when utilization is below 98%', () => {
    _setLastRateLimits({
      utilization5h: 0.5,
      status5h: 'allowed',
      reset5h: '1775163600',
      utilization7d: 0.3,
      status7d: 'allowed',
      reset7d: '1775473200',
      timestamp: new Date().toISOString(),
    })
    expect(buildRateLimitWarning()).toBeNull()
  })

  it('warns when 5h utilization reaches 98%', () => {
    _setLastRateLimits({
      utilization5h: 0.98,
      status5h: 'allowed',
      reset5h: '1775163600',
      utilization7d: 0.5,
      status7d: 'allowed',
      reset7d: '1775473200',
      timestamp: new Date().toISOString(),
    })
    const result = buildRateLimitWarning()
    expect(result).toContain('Approaching rate limit')
    expect(result).toContain('5h window at 98.0%')
    expect(result).not.toContain('7d window')
  })

  it('warns when 7d utilization reaches 98%', () => {
    _setLastRateLimits({
      utilization5h: 0.5,
      status5h: 'allowed',
      reset5h: '1775163600',
      utilization7d: 0.99,
      status7d: 'allowed',
      reset7d: '1775473200',
      timestamp: new Date().toISOString(),
    })
    const result = buildRateLimitWarning()
    expect(result).toContain('7d window at 99.0%')
    expect(result).not.toContain('5h window')
  })

  it('warns for both windows when both are at 98%+', () => {
    _setLastRateLimits({
      utilization5h: 0.99,
      status5h: 'allowed',
      reset5h: '1775163600',
      utilization7d: 0.98,
      status7d: 'allowed',
      reset7d: '1775473200',
      timestamp: new Date().toISOString(),
    })
    const result = buildRateLimitWarning()
    expect(result).toContain('5h window at 99.0%')
    expect(result).toContain('7d window at 98.0%')
  })

  it('includes reset time in the warning', () => {
    _setLastRateLimits({
      utilization5h: 1.0,
      status5h: 'rate_limited',
      reset5h: '1775163600',
      timestamp: new Date().toISOString(),
    })
    const result = buildRateLimitWarning()
    expect(result).toContain('resets')
    expect(result).toContain('2026-')
  })
})

describe('getStatusMessage', () => {
  afterEach(() => {
    _setLastRateLimits(null)
  })

  it('returns fallback when no data is cached', () => {
    expect(getStatusMessage()).toContain('No rate limit data available')
  })

  it('formats cached rate limits', () => {
    _setLastRateLimits({
      utilization5h: 0.24,
      status5h: 'allowed',
      reset5h: '1775163600',
      utilization7d: 0.22,
      status7d: 'allowed',
      reset7d: '1775473200',
      overageStatus: 'rejected',
      overageReason: 'out_of_credits',
      timestamp: '2026-04-02T17:00:00.000Z',
    })
    const result = getStatusMessage()
    expect(result).toContain('*5-hour window*')
    expect(result).toContain('24.0%')
    expect(result).toContain('*7-day window*')
    expect(result).toContain('22.0%')
    expect(result).toContain('out of credits')
    expect(result).toContain('2026-04-02T17:00:00.000Z')
  })
})
