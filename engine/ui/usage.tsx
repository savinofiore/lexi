import { atom, read, update } from 'claude-code'
import type { EngineInterface, Hook } from 'claude-code'
import type { Usage } from '../types'

export type Elements = ReturnType<EngineInterface['ui']['resolve']>

const usage = atom({ plugin: 'lexi', key: 'usage' } as const, null)
const routing = atom({ plugin: 'lexi', key: 'routing' } as const, null)
const nativeEffort = atom({ plugin: 'lexi', key: 'nativeEffort' } as const, null)
const cacheTokens = atom({ plugin: 'lexi', key: 'cacheTokens' } as const, 0)

// The usage gauges warm as a window fills.
export const GREEN = '#81c784'
export const YELLOW = '#fff176'
export const ORANGE = '#ffb74d'
export const RED = '#e57373'
const COST = '#4fc3f7'

const BAR_WIDTH = 10
const EIGHTHS = ' ▏▎▍▌▋▊▉'
const WINDOWS: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: 'wk', spend_limit: 'spend' }

const warmthOf = (percent: number): string => (percent >= 90 ? RED : percent >= 75 ? ORANGE : percent >= 50 ? YELLOW : GREEN)

// The filled cells, to an eighth of a cell, and the empty track after them.
const barOf = (percent: number): [string, string] => {
  const cells = (Math.max(0, Math.min(100, percent)) / 100) * BAR_WIDTH
  const whole = Math.floor(cells)
  const partial = whole < BAR_WIDTH ? EIGHTHS[Math.floor((cells - whole) * 8)]!.trim() : ''
  return ['█'.repeat(whole) + partial, '░'.repeat(BAR_WIDTH - whole - partial.length)]
}

// Time left to a reset, as 1d12h, 3h29m or 7m; empty once it has passed.
const countdownOf = (resetsAt: string | undefined, now: number): string => {
  const left = resetsAt === undefined ? 0 : Math.floor((Date.parse(resetsAt) - now) / 60_000)
  if (!(left > 0)) return ''
  const days = Math.floor(left / 1440)
  const hours = Math.floor((left % 1440) / 60)
  if (days > 0) return `${days}d${hours}h`
  return hours > 0 ? `${hours}h${String(left % 60).padStart(2, '0')}m` : `${left}m`
}

const tokensOf = (tokens: number, unit = 'tok'): string =>
  tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M ${unit}` : tokens >= 1e3 ? `${(tokens / 1e3).toFixed(1)}k ${unit}` : `${tokens} ${unit}`

const gauge = (ui: Elements, label: string, percent: number, countdown = '') => {
  const [filled, track] = barOf(percent)
  return (
    <ui.Box>
      <ui.Text dimColor>{label} </ui.Text>
      <ui.Text color={warmthOf(percent)}>{filled}</ui.Text>
      <ui.Text dimColor>{track}</ui.Text>
      <ui.Text color={warmthOf(percent)}> {Math.round(percent)}%</ui.Text>
      {countdown !== '' && <ui.Text dimColor> ⟳{countdown}</ui.Text>}
    </ui.Box>
  )
}

// shortcut: countdowns move only when the engine measures (each turn); add a $.clock tick if they must run live.
export const usageRow = (ui: Elements, now: Usage, at: number) => {
  const limits = now.rateLimits.filter((limit) => WINDOWS[limit.kind] !== undefined)
  const segments = [
    gauge(ui, 'ctx', now.context.percent ?? 0),
    ...limits.map((limit) => gauge(ui, WINDOWS[limit.kind]!, limit.percentUsed, countdownOf(limit.resetsAt, at))),
    <ui.Text bold>{now.model}</ui.Text>,
    ...(now.context.tokens === undefined ? [] : [<ui.Text dimColor>{tokensOf(now.context.tokens)}</ui.Text>]),
    ...(!now.cacheTokens ? [] : [<ui.Text dimColor>{tokensOf(now.cacheTokens, 'cache')}</ui.Text>]),
    ...(now.usd === undefined ? [] : [<ui.Text color={COST}>${now.usd.toFixed(2)}</ui.Text>]),
  ]
  // flexWrap keeps a narrow band from clipping the last segment: it drops to a second row instead.
  return (
    <ui.Box flexWrap="wrap">
      {segments.map((segment, index) => (
        <ui.Box>
          {index > 0 && <ui.Text dimColor> │ </ui.Text>}
          {segment}
        </ui.Box>
      ))}
    </ui.Box>
  )
}

// The engine's own status-line figures, pushed after each turn and on each rate-limit move.
export const onMeasure: Hook<'session.measure'> = async ($, e, next) => {
  const routed = await read($, routing)
  const effort = routed === null ? await read($, nativeEffort) : null
  // The router swaps the model per step, so the session's own model is not the one answering.
  const sessionModel = await $.session.model()
  const model = routed !== null ? `${routed.model} · ${routed.effort}` : effort === null ? sessionModel : `${sessionModel} · ${effort}`
  const { tokens, percent } = e.context
  const cached = await read($, cacheTokens)
  await update($, usage, () => ({ model, context: { tokens, percent }, rateLimits: [...e.rateLimits], usd: e.cost?.usd, cacheTokens: cached }))
  return next(e)
}
