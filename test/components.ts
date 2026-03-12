import { createRunner, createLocalFetchCompoment } from '@well-known-components/test-helpers'
import { Lifecycle } from '@well-known-components/interfaces'
import { setupRouter } from '../src/controllers/routes.js'
import { TestComponents, GlobalContext } from '../src/types.js'
import { initComponents as originalInitComponents } from '../src/components.js'

export const test = createRunner<TestComponents>({ main, initComponents })

async function initComponents(): Promise<TestComponents> {
  const components = await originalInitComponents()
  return {
    ...components,
    localFetch: await createLocalFetchCompoment(components.config)
  }
}

// Test-local main: only wires HTTP router — skips initAgent and startSlackBot
async function main(program: Lifecycle.EntryPointParameters<TestComponents>) {
  const { components, startComponents } = program
  const globalContext: GlobalContext = { components }
  const router = await setupRouter(globalContext)
  components.server.use(router.middleware())
  components.server.use(router.allowedMethods())
  components.server.setContext(globalContext)
  await startComponents()
}
