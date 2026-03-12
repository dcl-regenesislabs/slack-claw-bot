import { test } from '../components.js'

// The WKC createStatusCheckComponent registers /health/live and returns "alive"
test('health endpoint', function ({ components }) {
  it('GET /health/live returns 200', async () => {
    const { localFetch } = components
    const response = await localFetch.fetch('/health/live')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('alive')
  })
})
