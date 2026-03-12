import { Router } from '@well-known-components/http-server'
import { GlobalContext } from '../types.js'

// Note: /health/live is handled automatically by createStatusCheckComponent
export async function setupRouter(_globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  return router
}
