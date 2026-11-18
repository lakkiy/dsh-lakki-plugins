/**
 * Bind an OpenAI `service_tier` to a model id for a Responses-API proxy.
 *
 * DSH's pi-ai adapter never sends `service_tier`, so a tier cannot be selected
 * from the Models settings page. The supported upstream (MyCodex) only accepts
 * model ids it knows, so a client-visible id such as `gpt-6.2-sol-fast` has to
 * be rewritten to `gpt-6.2-sol` and annotated with `service_tier: priority`
 * before the request leaves the process.
 *
 * This plugin performs that rewrite at the fetch boundary: it wraps
 * `globalThis.fetch` for the configured hosts only, inspects a JSON
 * `/responses` body, and replaces the model id plus adds the tier. Everything
 * else — headers, streaming, cancellation — is passed through untouched.
 *
 * @module @local/mycodex-service-tier
 */

/** Slot holding the shared patch so repeated activations never double-wrap fetch. */
const PATCH_KEY = Symbol.for('dsh.mycodex-service-tier.patch')

/** @typedef {{ model: string, serviceTier: string }} TierMapping */

/**
 * Normalize a plugin config into the tables the interceptor uses.
 * @param {unknown} config - raw row config.
 * @returns {{ hosts: Set<string>, models: Map<string, TierMapping>, debug: boolean }}
 */
function normalize(config) {
  const raw = config && typeof config === 'object' ? config : {}
  const hosts = new Set(
    (Array.isArray(raw.hosts) ? raw.hosts : [])
      .map(host => String(host).trim().toLowerCase())
      .filter(Boolean),
  )
  const models = new Map()
  const table = raw.models && typeof raw.models === 'object' ? raw.models : {}
  for (const [id, spec] of Object.entries(table)) {
    if (!spec || typeof spec !== 'object') continue
    const upstream = spec.model === undefined ? id : String(spec.model)
    const serviceTier = spec.serviceTier === undefined ? 'priority' : String(spec.serviceTier)
    models.set(id, { model: upstream, serviceTier })
  }
  return { hosts, models, debug: raw.debug === true }
}

/**
 * Read the request URL without constructing it twice.
 * @param {unknown} input - fetch input.
 * @returns {URL | undefined} parsed URL or undefined when unparseable.
 */
function urlOf(input) {
  try {
    if (typeof input === 'string' || input instanceof URL) return new URL(String(input))
    if (input && typeof input === 'object' && typeof input.url === 'string') return new URL(input.url)
  } catch {
    // Fall through: an unparseable target is left alone.
  }
  return undefined
}

/**
 * Copy request headers with `content-length` removed, since the rewritten body
 * has a different length.
 * @param {HeadersInit | undefined} headers - original headers.
 * @returns {HeadersInit | undefined} headers safe to send with the new body.
 */
function withoutLength(headers) {
  if (headers === undefined || headers === null) return headers
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    const copy = new Headers(headers)
    copy.delete('content-length')
    return copy
  }
  if (Array.isArray(headers)) {
    return headers.filter(entry => String(entry[0]).toLowerCase() !== 'content-length')
  }
  const copy = {}
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-length') continue
    copy[key] = value
  }
  return copy
}

/**
 * Decide whether this request should be rewritten, and produce the replacement.
 * Only plain JSON string bodies are touched: a streamed or already-encoded body
 * cannot be inspected safely, and leaving it byte-identical keeps the failure
 * mode obvious.
 * @param {unknown} input - fetch input.
 * @param {RequestInit | undefined} init - fetch init.
 * @param {{ hosts: Set<string>, models: Map<string, TierMapping> }} state - active tables.
 * @returns {{ init: RequestInit } | undefined} replacement init, if this request matches.
 */
function rewrite(input, init, state) {
  if (!init || typeof init.body !== 'string' || init.body.length === 0) return undefined
  const url = urlOf(input)
  if (!url) return undefined
  if (!state.hosts.has(url.hostname.toLowerCase())) return undefined
  if (!url.pathname.replace(/\/+$/, '').endsWith('/responses')) return undefined

  let body
  try {
    body = JSON.parse(init.body)
  } catch {
    return undefined
  }
  if (!body || typeof body !== 'object' || typeof body.model !== 'string') return undefined
  const mapping = state.models.get(body.model)
  if (!mapping) return undefined

  body.model = mapping.model
  body.service_tier = mapping.serviceTier
  return { init: { ...init, body: JSON.stringify(body), headers: withoutLength(init.headers) } }
}

/**
 * Install (or refresh) the shared fetch wrapper.
 * @param {ReturnType<typeof normalize>} state - active tables.
 * @returns {{ release: () => void }} handle released when the plugin disposes.
 */
function install(state) {
  const existing = globalThis[PATCH_KEY]
  if (existing) {
    existing.state = state
    existing.count += 1
    return { release: () => existing.release() }
  }

  const original = globalThis.fetch
  const patched = function (input, init) {
    try {
      const replacement = rewrite(input, init, holder.state)
      if (replacement) return original.call(globalThis, input, replacement.init)
    } catch {
      // Never let the interceptor break an unrelated request.
    }
    return original.call(globalThis, input, init)
  }
  const holder = {
    state,
    count: 1,
    release() {
      holder.count -= 1
      if (holder.count > 0) return
      if (globalThis.fetch === patched) globalThis.fetch = original
      if (globalThis[PATCH_KEY] === holder) delete globalThis[PATCH_KEY]
    },
  }
  globalThis.fetch = patched
  globalThis[PATCH_KEY] = holder

  return { release: () => holder.release() }
}

/**
 * Mount the tier rewrite.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {unknown} config - row config, shaped as `{ hosts, models, debug }`.
 */
export function apply(ctx, config) {
  const state = normalize(config)
  ctx.effect(() => {
    const handle = install(state)
    return () => handle.release()
  }, 'mycodex-service-tier.fetch')
}

export const name = 'mycodex-service-tier'
