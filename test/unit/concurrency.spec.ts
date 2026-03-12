import { AgentScheduler, type SubmitResult } from '../../src/concurrency.js'

function accepted(result: SubmitResult): asserts result is { status: 'accepted'; done: Promise<void>; queued: boolean } {
  expect(typeof result === 'object' && (result as any).status === 'accepted').toBe(true)
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

  it('returns thread-busy for duplicate thread', () => {
    const scheduler = new AgentScheduler()
    scheduler.submit('t1', () => new Promise(() => {})) // never resolves
    expect(scheduler.submit('t1', async () => {})).toBe('thread-busy')
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

  it('queues excess work instead of rejecting', async () => {
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
    expect(r1.queued).toBe(false)

    const r2 = scheduler.submit('t2', async () => {
      order.push(2)
    })
    accepted(r2)
    expect(r2.queued).toBe(true)

    const r3 = scheduler.submit('t3', async () => {
      order.push(3)
    })
    accepted(r3)
    expect(r3.queued).toBe(true)

    resolve1()
    await r1.done
    await r2.done
    await r3.done
    expect(order).toEqual([1, 2, 3])
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
})
