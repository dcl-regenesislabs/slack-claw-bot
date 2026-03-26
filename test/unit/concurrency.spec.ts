import { AgentScheduler, type SubmitResult } from '../../src/concurrency.js'

function accepted(result: SubmitResult): asserts result is Extract<SubmitResult, { status: 'accepted' }> {
  expect(typeof result === 'object' && result.status === 'accepted').toBe(true)
}

describe('AgentScheduler', () => {
  it('runs accepted work', async () => {
    const scheduler = new AgentScheduler()
    let ran = false
    const result = scheduler.submit('t1', async () => {
      ran = true
    })
    accepted(result)
    await result.done
    expect(ran).toBe(true)
  })

  it('queues behind thread for duplicate thread instead of rejecting', async () => {
    const scheduler = new AgentScheduler()
    let resolve1!: () => void
    const blocker = new Promise<void>((r) => { resolve1 = r })

    const r1 = scheduler.submit('t1', async () => { await blocker })
    accepted(r1)

    const r2 = scheduler.submit('t1', async () => {})
    expect(r2.status).toBe('queued-behind-thread')

    resolve1()
    await r1.done
    await r2.done
  })

  it('allows reuse after completion', async () => {
    const scheduler = new AgentScheduler()
    const r1 = scheduler.submit('t1', async () => {})
    accepted(r1)
    await r1.done
    const r2 = scheduler.submit('t1', async () => {})
    accepted(r2)
    await r2.done
  })

  it('respects maxConcurrent by queuing excess work', async () => {
    const scheduler = new AgentScheduler(1)
    const order: number[] = []
    let resolve1!: () => void
    const blocker = new Promise<void>((r) => {
      resolve1 = r
    })

    const r1 = scheduler.submit('t1', async () => {
      await blocker
      order.push(1)
    })
    accepted(r1)

    const r2 = scheduler.submit('t2', async () => {
      order.push(2)
    })
    accepted(r2)

    resolve1()
    await r1.done
    await r2.done
    expect(order).toEqual([1, 2])
  })

  it('returns queue position and estimated wait', async () => {
    const scheduler = new AgentScheduler(1)
    let resolve1!: () => void
    const blocker = new Promise<void>((r) => {
      resolve1 = r
    })

    const r1 = scheduler.submit('t1', async () => { await blocker })
    accepted(r1)
    expect(r1.queued).toBe(false)
    expect(r1.queuePosition).toBe(0)

    const r2 = scheduler.submit('t2', async () => {})
    accepted(r2)
    expect(r2.queued).toBe(true)
    expect(r2.queuePosition).toBe(0) // first in queue
    expect(r2.estimatedWaitSec).toBeGreaterThan(0)

    const r3 = scheduler.submit('t3', async () => {})
    accepted(r3)
    expect(r3.queued).toBe(true)
    expect(r3.queuePosition).toBe(1) // second in queue
    expect(r3.estimatedWaitSec).toBeGreaterThanOrEqual(r2.estimatedWaitSec)

    resolve1()
    await r1.done
    await r2.done
    await r3.done
  })

  it('fires onDequeued when queued work starts', async () => {
    const scheduler = new AgentScheduler(1)
    const dequeued: string[] = []
    scheduler.onDequeued = (threadId) => dequeued.push(threadId)

    let resolve1!: () => void
    const blocker = new Promise<void>((r) => { resolve1 = r })

    const r1 = scheduler.submit('t1', async () => { await blocker })
    accepted(r1)

    const r2 = scheduler.submit('t2', async () => {})
    accepted(r2)
    expect(r2.queued).toBe(true)

    resolve1()
    await r1.done
    await r2.done
    expect(dequeued).toEqual(['t2'])
  })

  it('propagates errors from work', async () => {
    const scheduler = new AgentScheduler()
    const result = scheduler.submit('t1', async () => {
      throw new Error('boom')
    })
    accepted(result)
    await expect(result.done).rejects.toThrow('boom')
  })

  it('frees thread on throw', async () => {
    const scheduler = new AgentScheduler()
    const r1 = scheduler.submit('t1', async () => {
      throw new Error('boom')
    })
    accepted(r1)
    await r1.done.catch(() => {})
    const r2 = scheduler.submit('t1', async () => {})
    accepted(r2)
    await r2.done
  })

  it('updates avgProcessingSec after completions', async () => {
    const scheduler = new AgentScheduler()
    // Default before any completions
    expect(scheduler.avgProcessingSec).toBe(60)

    const r1 = scheduler.submit('t1', async () => {})
    accepted(r1)
    await r1.done

    // After completion, should be a small number (near 0)
    expect(scheduler.avgProcessingSec).toBeLessThan(1)
  })

  it('drain resolves when all work completes', async () => {
    const scheduler = new AgentScheduler(1)
    let resolve1!: () => void
    const blocker = new Promise<void>((r) => { resolve1 = r })

    const r1 = scheduler.submit('t1', async () => { await blocker })
    accepted(r1)

    const drainPromise = scheduler.drain(5000)
    resolve1()
    await drainPromise
  })
})
