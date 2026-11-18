/**
 * @local/sidebar-pins — browser half.
 *
 * Two features over the shipped sidebar browser:
 *
 * 1. Workspace pin (workspace "..." menu -> Pin workspace / Unpin workspace).
 *    The pinned workspace is moved to the front of the durable registry order
 *    through the native `workspaces.insertBefore` Remote, remembering the
 *    workspace that followed it so unpin restores that exact slot. Pinned rows
 *    carry a small pin glyph painted by CSS from a data attribute this half
 *    keeps up to date.
 *
 * 2. Global session pin (session "..." menu -> Pin globally / Unpin globally).
 *    Pinned sessions are collected in one "Pinned" section rendered above every
 *    workspace group, inside the browsing region's own scroller. The shipped
 *    row stays in its workspace, so the same session is reachable twice. The
 *    section is portaled into the shipped `[data-sidebar-list-area]` element;
 *    the shipped browser is never replaced, only decorated with that host.
 *
 * Pin sets and the collapse choice live in localStorage (browser-local). The
 * workspace pin also writes the Host order, so it survives restarts and is
 * visible to every browser of this profile; session pins are display-level.
 */
window.__ModuleLoader__.load({
  id: '@local/sidebar-pins',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useState, useEffect, useRef, useSyncExternalStore } = React

    const NS = 'sidebarPins'
    const STORAGE_KEY = 'dsh.sidebar-pins.v1'
    const LIST_AREA_SELECTOR = '[data-sidebar-list-area]'
    const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]'
    const SEARCH_ROW_TOKEN = 'searchResultRow'
    const HOST_ATTR = 'data-dsh-pins-host'
    const PINNED_ATTR = 'data-dsh-pins-workspace'
    const WORKSPACE_PREFIX = 'workspace:'

    const zh = {
      section: '置顶',
      collapse: '收起置顶会话',
      expand: '展开置顶会话',
      pinWorkspace: '置顶工作区',
      unpinWorkspace: '取消置顶工作区',
      pinSession: '全局置顶',
      unpinSession: '取消全局置顶',
      unpin: '取消置顶',
      unpinNamed: '取消置顶 {title}',
      pinned: '已全局置顶',
      orderFailed: '调整工作区顺序失败',
    }
    const en = {
      section: 'Pinned',
      collapse: 'Collapse pinned sessions',
      expand: 'Expand pinned sessions',
      pinWorkspace: 'Pin workspace',
      unpinWorkspace: 'Unpin workspace',
      pinSession: 'Pin globally',
      unpinSession: 'Unpin globally',
      unpin: 'Unpin',
      unpinNamed: 'Unpin {title}',
      pinned: 'Pinned globally',
      orderFailed: 'Could not reorder workspaces',
    }

    const CSS_TEXT = `
.dsh-pins { display: flex; flex-direction: column; gap: 1px; padding: 0 0 4px; }
.dsh-pins-head { display: flex; align-items: center; }
.dsh-pins-toggle { all: unset; box-sizing: border-box; cursor: pointer; display: flex; align-items: center; gap: var(--dsh-sidebar-label-gap, 8px); width: 100%; height: 28px; padding: 0 var(--dsh-sidebar-row-padding, 8px); border-radius: var(--dsw-radius-md); color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 20px; }
.dsh-pins-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-pins-toggle:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color); outline-offset: 1px; }
.dsh-pins-chevron { display: inline-flex; flex: none; width: 10px; height: 10px; transition: transform 120ms ease; color: var(--dsw-alias-label-tertiary); }
.dsh-pins-chevron[data-open="true"] { transform: rotate(90deg); }
.dsh-pins-chevron svg { display: block; width: 10px; height: 10px; }
.dsh-pins-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.dsh-pins-count { flex: none; color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; }
.dsh-pins-list { display: flex; flex-direction: column; gap: 1px; }
.dsh-pins-row { display: flex; align-items: center; gap: var(--dsh-sidebar-label-gap, 8px); height: 32px; padding-inline: calc(var(--dsh-sidebar-row-padding, 8px) - var(--dsh-sidebar-paint-inset, 0px)) calc(var(--dsh-sidebar-row-padding, 8px) - 4px); border-radius: var(--dsw-radius-md); cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 20px; }
.dsh-pins-row:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-pins-row[data-selected="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-pins-row[data-dragging="true"] { opacity: 0.55; }
.dsh-pins-row[data-drop="before"] { box-shadow: inset 0 2px 0 0 var(--dsw-alias-state-business-primary); }
.dsh-pins-row[data-drop="after"] { box-shadow: inset 0 -2px 0 0 var(--dsw-alias-state-business-primary); }
.dsh-pins-row:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color); outline-offset: -1px; }
.dsh-pins-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-dimmed); }
.dsh-pins-dot[data-running="true"] { background: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, transparent); }
.dsh-pins-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-pins-meta { flex: none; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-pins-remove { all: unset; box-sizing: border-box; flex: none; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: var(--dsw-radius-xs); cursor: pointer; color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 1; opacity: 0; }
.dsh-pins-row:hover .dsh-pins-remove, .dsh-pins-remove:focus-visible { opacity: 1; }
.dsh-pins-remove:hover, .dsh-pins-remove:focus-visible { color: var(--dsw-alias-label-primary); }
.dsh-pins-remove:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color); outline-offset: 1px; }
@media (hover: none) {
  .dsh-pins-remove { opacity: 1; }
}
[${PINNED_ATTR}="true"]::after { content: ''; flex: none; width: 12px; height: 12px; margin-left: 4px; background-color: var(--dsw-alias-label-tertiary); -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M9.97 1.706 13.155 3.936 10.902 8.123 11.516 11.605 10.719 12.743 2.528 7.007 3.324 5.869 6.806 5.255 9.97 1.706Z' fill='black'/%3E%3Cpath d='M6.053 9.475a.7.7 0 0 1 1.138.797l-3.205 4.199-.774-.542 2.841-4.454Z' fill='black'/%3E%3C/svg%3E") center / contain no-repeat; mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M9.97 1.706 13.155 3.936 10.902 8.123 11.516 11.605 10.719 12.743 2.528 7.007 3.324 5.869 6.806 5.255 9.97 1.706Z' fill='black'/%3E%3Cpath d='M6.053 9.475a.7.7 0 0 1 1.138.797l-3.205 4.199-.774-.542 2.841-4.454Z' fill='black'/%3E%3C/svg%3E") center / contain no-repeat; }
`

    /* ------------------------------------------------------------ persisted state */

    /** Sanitize one stored record; any malformed field falls back to an empty set. */
    function sanitize(raw) {
      const fallback = { sessions: [], workspaces: [], collapsed: false }
      if (raw === null || typeof raw !== 'object') return fallback
      const sessions = Array.isArray(raw.sessions)
        ? raw.sessions.filter(id => typeof id === 'string')
        : []
      const workspaces = Array.isArray(raw.workspaces)
        ? raw.workspaces
          .filter(item => item !== null && typeof item === 'object' && typeof item.id === 'string')
          .map(item => ({ id: item.id, after: typeof item.after === 'string' ? item.after : null }))
        : []
      return { sessions: Array.from(new Set(sessions)), workspaces, collapsed: raw.collapsed === true }
    }

    function readState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return sanitize(raw === null ? null : JSON.parse(raw))
      } catch (error) {
        return sanitize(null)
      }
    }

    let state = readState()
    const listeners = new Set()

    function getSnapshot() { return state }
    function subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }
    function commit(patch) {
      state = { ...state, ...patch }
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch (error) { /* private mode */ }
      for (const listener of Array.from(listeners)) {
        try { listener() } catch (error) { /* keep notifying */ }
      }
    }
    const store = { getSnapshot, subscribe }

    function isSessionPinned(sessionId) { return state.sessions.includes(sessionId) }
    function isWorkspacePinned(workspaceId) { return state.workspaces.some(item => item.id === workspaceId) }

    function pinSession(sessionId) {
      if (isSessionPinned(sessionId)) return
      // A pin the user cannot see is no feedback: reveal the section with it.
      commit({ sessions: [sessionId, ...state.sessions], collapsed: false })
    }
    function unpinSession(sessionId) {
      if (!isSessionPinned(sessionId)) return
      commit({ sessions: state.sessions.filter(id => id !== sessionId) })
    }
    /** Move one pinned session beside another; the array is the section's display order. */
    function movePinnedSession(sessionId, targetId, after) {
      const list = state.sessions.filter(id => id !== sessionId)
      const index = list.indexOf(targetId)
      if (!state.sessions.includes(sessionId) || sessionId === targetId || index < 0) return
      list.splice(index + (after ? 1 : 0), 0, sessionId)
      commit({ sessions: list })
    }
    function toggleSession(sessionId) {
      if (isSessionPinned(sessionId)) unpinSession(sessionId)
      else pinSession(sessionId)
    }
    function setCollapsed(collapsed) {
      if (state.collapsed === collapsed) return
      commit({ collapsed })
    }

    /** Directory basename used when a session belongs to no registered workspace. */
    function basename(path) {
      if (typeof path !== 'string' || path === '') return ''
      const parts = path.split(/[\\/]/).filter(part => part !== '')
      return parts.length === 0 ? path : parts[parts.length - 1]
    }

    /* ------------------------------------------------------------------- plugin */

    return {
      inject: ['slots', 'locale', 'contextMenus', 'workspaces', 'uiWorkspace'],
      apply(ctx) {
        const workspaces = ctx.get('workspaces')
        const contextMenus = ctx.get('contextMenus')
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidebar-pins: dictionaries')
        const t = ctx.locale.bind(NS)

        const order = () => workspaces.list.getSnapshot().items.map(item => item.workspaceId)

        // Host order writes are serialized so two quick pins cannot interleave.
        // A rejected write surfaces through the menu's failure label; the
        // optimistic record is rolled back so state never claims a reorder the
        // Host refused.
        let queue = Promise.resolve()
        let reorderRefused = false
        const enqueue = task => {
          const next = queue.then(task)
          queue = next.catch(() => {})
          return next
        }

        function pinWorkspace(workspaceId) {
          if (isWorkspacePinned(workspaceId)) return Promise.resolve()
          const ids = order()
          const index = ids.indexOf(workspaceId)
          if (index < 0) return Promise.resolve()
          const after = index + 1 < ids.length ? ids[index + 1] : null
          reorderRefused = false
          commit({ workspaces: [{ id: workspaceId, after }, ...state.workspaces] })
          return enqueue(async () => {
            const current = order()
            if (!current.includes(workspaceId) || current[0] === workspaceId) return
            await workspaces.insertBefore(workspaceId, current[0])
          }).catch(error => {
            commit({ workspaces: state.workspaces.filter(item => item.id !== workspaceId) })
            console.warn('[sidebar-pins] workspace pin was refused:', error)
            throw error
          })
        }

        function unpinWorkspace(workspaceId) {
          const record = state.workspaces.find(item => item.id === workspaceId)
          if (record === undefined) return Promise.resolve()
          const position = state.workspaces.indexOf(record)
          reorderRefused = false
          commit({ workspaces: state.workspaces.filter(item => item.id !== workspaceId) })
          return enqueue(async () => {
            const current = order()
            if (!current.includes(workspaceId)) return
            // Exact restore: insert before the workspace that used to follow it.
            if (record.after !== null && record.after !== workspaceId && current.includes(record.after)) {
              await workspaces.insertBefore(workspaceId, record.after)
              return
            }
            // The follower is gone: leave the remaining pinned block intact.
            const pinned = new Set(state.workspaces.map(item => item.id))
            const firstUnpinned = current.find(other => other !== workspaceId && !pinned.has(other))
            await workspaces.insertBefore(workspaceId, firstUnpinned)
          }).catch(error => {
            const restored = [...state.workspaces]
            restored.splice(Math.max(position, 0), 0, record)
            commit({ workspaces: restored })
            console.warn('[sidebar-pins] workspace unpin was refused:', error)
            throw error
          })
        }

        function toggleWorkspace(workspaceId) {
          return isWorkspacePinned(workspaceId) ? unpinWorkspace(workspaceId) : pinWorkspace(workspaceId)
        }

        function reorderAllowed(workspaceId) {
          const access = ctx.get('remoteAccess')
          if (access === undefined) return true
          try {
            return access.source('workspace', workspaceId, 'workspace/insertBefore').getSnapshot()
          } catch (error) {
            return true
          }
        }

        /**
         * Keep pinned workspaces at the front of the durable order. Internal
         * order inside the pinned block is left alone, so dragging one pinned
         * workspace among the others is not undone.
         */
        function reconcileOrder() {
          if (reorderRefused) return
          if (state.workspaces.length === 0) return
          const snapshot = workspaces.list.getSnapshot()
          // While the baseline is still arriving an empty or partial list must
          // not be read as "these workspaces were deleted".
          if (snapshot.phase === 'pending') return
          enqueue(async () => {
            const ids = order()
            const wanted = state.workspaces.map(item => item.id)
            const present = wanted.filter(id => ids.includes(id))
            if (present.length !== wanted.length) {
              commit({ workspaces: state.workspaces.filter(item => ids.includes(item.id)) })
            }
            if (present.length === 0) return
            const pinned = new Set(present)
            const leading = ids.slice(0, present.length)
            if (leading.every(id => pinned.has(id))) return
            for (let index = present.length - 1; index >= 0; index -= 1) {
              const id = present[index]
              if (!reorderAllowed(id)) continue
              const current = order()
              if (!current.includes(id) || current[0] === id) continue
              await workspaces.insertBefore(id, current[0])
            }
          }).catch(error => {
            reorderRefused = true
            console.warn('[sidebar-pins] pinned workspace order was refused:', error)
          })
        }

        let reconcileTimer
        ctx.effect(() => {
          const stop = workspaces.list.subscribe(() => {
            clearTimeout(reconcileTimer)
            reconcileTimer = setTimeout(reconcileOrder, 150)
          })
          reconcileOrder()
          return () => {
            stop()
            clearTimeout(reconcileTimer)
          }
        }, 'sidebar-pins: workspace order')

        ctx.effect(() => contextMenus.register({
          id: 'sidebarPins.workspace',
          target: 'workspace',
          order: 40,
          observe: () => [store, ctx.locale],
          resolve: ({ workspaceId }) => {
            if (!reorderAllowed(workspaceId)) return []
            const pinned = isWorkspacePinned(workspaceId)
            return [{
              id: 'sidebarPins.workspace.toggle',
              label: t(pinned ? 'unpinWorkspace' : 'pinWorkspace'),
              icon: { key: pinned ? 'workspace.unpin' : 'workspace.pin' },
              failureLabel: t('orderFailed'),
              run: () => toggleWorkspace(workspaceId),
            }]
          },
        }), 'sidebar-pins: workspace menu')

        ctx.effect(() => contextMenus.register({
          id: 'sidebarPins.session',
          target: 'session',
          order: 105,
          observe: () => [store, workspaces.list, ctx.locale],
          resolve: ({ sessionId }) => {
            if (workspaces.list.getSnapshot().archivedSessionIds.includes(sessionId)) return []
            const pinned = isSessionPinned(sessionId)
            return [{
              id: 'sidebarPins.session.toggle',
              label: t(pinned ? 'unpinSession' : 'pinSession'),
              icon: { key: pinned ? 'workspace.unpin' : 'workspace.pin' },
              run: () => { toggleSession(sessionId) },
            }]
          },
        }), 'sidebar-pins: session menu')

        /**
         * Pin glyph on a globally pinned session's own row in its workspace, so
         * the state is visible where the session normally lives too.
         */
        function SessionPinMarker({ sessionId }) {
          const rootPins = useSyncExternalStore(subscribe, getSnapshot)
          useLocaleRevision()
          if (!rootPins.sessions.includes(sessionId)) return null
          return h('span', {
            title: t('pinned'),
            'aria-hidden': 'true',
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              flex: 'none',
              color: 'var(--dsw-alias-label-tertiary)',
            },
          }, h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
            h('path', { d: 'M9.97 1.706 13.155 3.936 10.902 8.123 11.516 11.605 10.719 12.743 2.528 7.007 3.324 5.869 6.806 5.255 9.97 1.706Z', fill: 'currentColor' }),
            h('path', { d: 'M6.053 9.475a.7.7 0 0 1 1.138.797l-3.205 4.199-.774-.542 2.841-4.454Z', fill: 'currentColor' }),
          ))
        }

        ctx.effect(() => ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register(
          { name: 'sidebar.session.row.trailing', id: 'sidebar-pins', order: 0 },
          SessionPinMarker,
        )), 'sidebar-pins: session row marker')

        const openSession = sessionId => {
          const uiWorkspace = ctx.get('uiWorkspace')
          if (uiWorkspace === undefined) {
            console.warn('[sidebar-pins] uiWorkspace is unavailable; cannot open', sessionId)
            return
          }
          uiWorkspace.openSession(sessionId)
        }

        /** Re-render the section when the locale changes without re-registering it. */
        function useLocaleRevision() {
          const [revision, setRevision] = useState(0)
          useEffect(() => ctx.locale.subscribe(() => setRevision(value => value + 1)), [])
          return revision
        }

        function Overlay(props) {
          const rootPins = useSyncExternalStore(subscribe, getSnapshot)
          const workspaceSnapshot = props.useWorkspaces(snapshot => snapshot)
          const sessionSnapshot = props.useSessions(snapshot => snapshot)
          const statusBySession = props.useSessionStatus(snapshot => snapshot)
          const panelActive = props.usePanelInfo(info => info.activePanelId !== null)
          useLocaleRevision()
          const [host, setHost] = useState(null)
          const [visible, setVisible] = useState(false)
          const [drag, setDrag] = useState(null)
          const [drop, setDrop] = useState(null)
          const pinnedWorkspaces = useRef(new Set())

          useEffect(() => {
            pinnedWorkspaces.current = new Set(rootPins.workspaces.map(item => item.id))
            markPinnedRows()
          }, [rootPins.workspaces])

          function markPinnedRows() {
            const area = document.querySelector(LIST_AREA_SELECTOR)
            if (area === null) return
            const pinned = pinnedWorkspaces.current
            for (const row of area.querySelectorAll(WORKSPACE_ROW_SELECTOR)) {
              const key = row.getAttribute('data-row-key') || ''
              const id = key.slice(WORKSPACE_PREFIX.length)
              if (id !== '' && pinned.has(id)) row.setAttribute(PINNED_ATTR, 'true')
              else row.removeAttribute(PINNED_ATTR)
            }
          }

          useEffect(() => {
            let disposed = false
            const hostElement = document.createElement('div')
            hostElement.setAttribute(HOST_ATTR, '')
            let area = null
            let observer = null

            const attach = () => {
              if (disposed) return
              const next = document.querySelector(LIST_AREA_SELECTOR)
              if (next === null) {
                if (area !== null) {
                  area = null
                  setHost(null)
                }
                setVisible(false)
                return
              }
              if (area !== next || hostElement.parentNode !== next || next.firstChild !== hostElement) {
                if (observer !== null) observer.disconnect()
                area = next
                next.insertBefore(hostElement, next.firstChild)
                observer = new MutationObserver(() => { attach() })
                observer.observe(next, { childList: true, subtree: true })
              }
              setHost(current => (current === hostElement ? current : hostElement))
              const show = next.querySelector(WORKSPACE_ROW_SELECTOR) !== null
                && next.querySelector('[class*="' + SEARCH_ROW_TOKEN + '"]') === null
              setVisible(current => (current === show ? current : show))
              markPinnedRows()
            }

            const timer = setInterval(attach, 1000)
            attach()
            return () => {
              disposed = true
              clearInterval(timer)
              if (observer !== null) observer.disconnect()
              if (hostElement.parentNode !== null) hostElement.parentNode.removeChild(hostElement)
            }
          }, [])

          const archived = new Set(workspaceSnapshot.archivedSessionIds)
          const workspaceTitle = new Map()
          const sessionWorkspace = new Map()
          for (const workspace of workspaceSnapshot.items) {
            workspaceTitle.set(workspace.workspaceId, workspace.title)
            for (const sessionId of workspace.sessionIds) {
              if (!sessionWorkspace.has(sessionId)) sessionWorkspace.set(sessionId, workspace.workspaceId)
            }
          }
          const rows = []
          for (const sessionId of rootPins.sessions) {
            const summary = sessionSnapshot.byId[sessionId]
            if (summary === undefined || archived.has(sessionId) || summary.origin === 'subagent') continue
            const workspaceId = sessionWorkspace.get(sessionId)
            const meta = workspaceId === undefined ? basename(summary.cwd) : (workspaceTitle.get(workspaceId) ?? '')
            rows.push({
              id: sessionId,
              title: summary.displayTitle,
              meta,
              running: statusBySession.get(sessionId)?.running === true,
            })
          }
          // The main view's open session, hidden while another panel is active —
          // the same rule the shipped rows use for their selected state.
          let currentSessionId = null
          if (!panelActive) {
            for (const id of sessionSnapshot.ids) {
              if ((sessionSnapshot.byId[id]?.retainedBy?.mainView ?? 0) > 0) {
                currentSessionId = id
                break
              }
            }
          }

          if (host === null || !visible || rows.length === 0) return null

          return ReactDOM.createPortal(
            h('div', { className: 'dsh-pins' },
              h('style', { key: 'style' }, CSS_TEXT),
              h('div', { className: 'dsh-pins-head', key: 'head' },
                h('button', {
                  type: 'button',
                  className: 'dsh-pins-toggle',
                  'aria-expanded': !rootPins.collapsed,
                  title: t(rootPins.collapsed ? 'expand' : 'collapse'),
                  onClick: () => { setCollapsed(!rootPins.collapsed) },
                },
                  h('span', { className: 'dsh-pins-chevron', 'data-open': String(!rootPins.collapsed) },
                    h('svg', { viewBox: '0 0 10 10', 'aria-hidden': 'true' },
                      h('path', {
                        d: 'M3 1.5 6.5 5 3 8.5',
                        fill: 'none',
                        stroke: 'currentColor',
                        strokeWidth: '1.4',
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                      })),
                  ),
                  h('span', { className: 'dsh-pins-label' }, t('section')),
                  h('span', { className: 'dsh-pins-count' }, String(rows.length)),
                ),
              ),
              rootPins.collapsed
                ? null
                : h('div', { className: 'dsh-pins-list', key: 'list' }, rows.map(row => h('div', {
                  key: row.id,
                  className: 'dsh-pins-row',
                  draggable: true,
                  role: 'button',
                  tabIndex: 0,
                  title: row.title,
                  'aria-current': row.id === currentSessionId ? 'true' : undefined,
                  'data-selected': row.id === currentSessionId ? 'true' : undefined,
                  'data-dragging': drag !== null && drag.id === row.id ? 'true' : undefined,
                  'data-drop': drop !== null && drop.id === row.id ? (drop.after ? 'after' : 'before') : undefined,
                  onClick: () => { openSession(row.id) },
                  onKeyDown: (event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                      event.preventDefault()
                      const index = rows.findIndex(item => item.id === row.id)
                      const neighbor = rows[index + (event.key === 'ArrowUp' ? -1 : 1)]
                      if (neighbor !== undefined) {
                        movePinnedSession(row.id, neighbor.id, event.key === 'ArrowDown')
                      }
                      return
                    }
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    openSession(row.id)
                  },
                  onDragStart: (event) => {
                    const data = event.dataTransfer
                    if (data !== null && data !== undefined) {
                      data.effectAllowed = 'move'
                      try { data.setData('text/plain', row.id) } catch (error) { /* some browsers refuse */ }
                    }
                    setDrag({ id: row.id })
                    setDrop(null)
                  },
                  onDragEnd: () => {
                    setDrag(null)
                    setDrop(null)
                  },
                  onDragOver: (event) => {
                    if (drag === null || drag.id === row.id) return
                    event.preventDefault()
                    if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'move'
                    const rect = event.currentTarget.getBoundingClientRect()
                    const after = event.clientY > rect.top + rect.height / 2
                    setDrop(current => (current !== null && current.id === row.id && current.after === after
                      ? current
                      : { id: row.id, after }))
                  },
                  onDrop: (event) => {
                    if (drag === null) return
                    event.preventDefault()
                    const rect = event.currentTarget.getBoundingClientRect()
                    const after = event.clientY > rect.top + rect.height / 2
                    if (drag.id !== row.id) movePinnedSession(drag.id, row.id, after)
                    setDrag(null)
                    setDrop(null)
                  },
                },
                  h('span', { className: 'dsh-pins-dot', 'data-running': String(row.running) }),
                  h('span', { className: 'dsh-pins-title' }, row.title),
                  row.meta === ''
                    ? null
                    : h('span', { className: 'dsh-pins-meta' }, row.meta),
                  h('button', {
                    type: 'button',
                    className: 'dsh-pins-remove',
                    title: t('unpin'),
                    'aria-label': t('unpinNamed', { title: row.title }),
                    onClick: (event) => {
                      event.stopPropagation()
                      unpinSession(row.id)
                    },
                  }, '\u00d7'),
                ))),
            ),
            host,
          )
        }

        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'sidebar-pins', order: 10 },
          Overlay,
        )), 'sidebar-pins: overlay')
      },
    }
  },
})
