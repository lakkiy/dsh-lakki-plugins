/**
 * Offline self-check for the browser half: loads client.js under a stubbed
 * module protocol, applies the plugin against a fake Client context, and
 * exercises the two menu contributions plus the pin bookkeeping.
 */
const assert = require('node:assert/strict')
const path = require('node:path')

const calls = { menus: [], slots: [] }
let captured = null
global.window = {
  __ModuleLoader__: {
    load(definition) { captured = definition },
  },
}

const storage = new Map()
global.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null },
  setItem(key, value) { storage.set(key, value) },
  removeItem(key) { storage.delete(key) },
}

require(path.join(__dirname, '..', 'client.js'))
assert.equal(captured.id, '@local/sidebar-pins')

const react = {
  createElement() { return { type: 'element' } },
  useState(value) { return [value, () => {}] },
  useEffect() {},
  useRef(value) { return { current: value } },
  useSyncExternalStore() { return {} },
}
const reactDom = { createPortal() { return null } }
const plugin = captured.factory(name => {
  if (name === 'react') return react
  if (name === 'react-dom') return reactDom
  throw new Error('unexpected module request: ' + name)
})

assert.ok(Array.isArray(plugin.inject))
assert.ok(plugin.inject.includes('contextMenus'))

const workspaceItems = [
  { workspaceId: 'w1', title: 'Alpha', sessionIds: ['s1', 's2'] },
  { workspaceId: 'w2', title: 'Beta', sessionIds: ['s3'] },
]
const hostOrder = []
const listListeners = new Set()

const ctx = {
  get(name) {
    if (name === 'workspaces') {
      return {
        list: {
          getSnapshot: () => ({ items: workspaceItems, archivedSessionIds: [] }),
          subscribe: (listener) => {
            listListeners.add(listener)
            return () => listListeners.delete(listener)
          },
        },
        insertBefore: async (workspaceId, beforeWorkspaceId) => {
          hostOrder.push([workspaceId, beforeWorkspaceId])
        },
      }
    }
    if (name === 'contextMenus') {
      return {
        register(contribution) {
          calls.menus.push(contribution)
          return () => {}
        },
      }
    }
    if (name === 'uiWorkspace') return { openSession() {} }
    return undefined
  },
  effect(fn) { return fn() },
  locale: {
    register() { return () => {} },
    bind: () => (key, params) => (params === undefined ? key : key + ':' + params.title),
    subscribe() { return () => {} },
  },
  slots: {
    inject(key, callback) {
      const dispose = callback()
      calls.slots.push({ key, dispose })
      return () => { if (typeof dispose === 'function') dispose() }
    },
    register(options, component) {
      calls.slots.push({ options, component })
      return () => {}
    },
  },
}

plugin.apply(ctx)

const overlay = calls.slots.find(entry => entry.options?.name === 'shell.overlay')
assert.ok(overlay, 'overlay registers into shell.overlay')
assert.equal(overlay.options.id, 'sidebar-pins')

const rowMarker = calls.slots.find(entry => entry.options?.name === 'sidebar.session.row.trailing')
assert.ok(rowMarker, 'session row marker registers into sidebar.session.row.trailing')
assert.equal(rowMarker.options.id, 'sidebar-pins')

const workspaceMenu = calls.menus.find(contribution => contribution.target === 'workspace')
const sessionMenu = calls.menus.find(contribution => contribution.target === 'session')
assert.ok(workspaceMenu, 'workspace menu contribution registers')
assert.ok(sessionMenu, 'session menu contribution registers')
assert.ok(workspaceMenu.observe().length > 0)
assert.ok(sessionMenu.observe().length > 0)

const workspaceAction = workspaceMenu.resolve({ workspaceId: 'w2', path: '/tmp/beta', displayTitle: 'Beta' })
assert.equal(workspaceAction.length, 1)
assert.equal(workspaceAction[0].label, 'pinWorkspace')
workspaceAction[0].run()

const sessionAction = sessionMenu.resolve({ sessionId: 's3', displayTitle: 'Gamma' })
assert.equal(sessionAction.length, 1)
assert.equal(sessionAction[0].label, 'pinSession')
sessionAction[0].run()

const pinnedAgain = workspaceMenu.resolve({ workspaceId: 'w2', path: '/tmp/beta', displayTitle: 'Beta' })[0]
assert.equal(pinnedAgain.label, 'unpinWorkspace')
assert.equal(sessionMenu.resolve({ sessionId: 's3', displayTitle: 'Gamma' })[0].label, 'unpinSession')

pinnedAgain.run()

setTimeout(() => {
  assert.deepEqual(hostOrder, [['w2', 'w1'], ['w2', 'w1']])
  assert.deepEqual(JSON.parse(storage.get('dsh.sidebar-pins.v1')), {
    sessions: ['s3'],
    workspaces: [],
    collapsed: false,
  })
  console.log('sidebar-pins selfcheck: ok')
}, 60)
