import { MR_URL_PATTERN, PR_URL_PATTERN } from '../../src/agent.js'

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
