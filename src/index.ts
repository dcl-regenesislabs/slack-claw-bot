import { Lifecycle } from '@well-known-components/interfaces'
import { initComponents } from './components.js'
import { main } from './service.js'

Lifecycle.run({ main, initComponents })
