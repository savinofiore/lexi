import { atom, read, update } from 'claude-code'
import type { EngineInterface, Hook } from 'claude-code'
import type { Usage } from '../types'

export type Elements = ReturnType<EngineInterface['ui']['resolve']>

const usage = atom({ plugin: 'lexi-mods', key: 'usage' } as const, null)
const turnModel = atom({ plugin: 'lexi-mods', key: 'turnModel' } as const, null)

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

const tokensOf = (tokens: number): string =>
  tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)}M tok` : tokens >= 1e3 ? `${(tokens / 1e3).toFixed(1)}k tok` : `${tokens} tok`

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
    <ui.Text bold>{now.model}</ui.Text>,
    gauge(ui, 'ctx', now.context.percent ?? 0),
    ...limits.map((limit) => gauge(ui, WINDOWS[limit.kind]!, limit.percentUsed, countdownOf(limit.resetsAt, at))),
    ...(now.context.tokens === undefined ? [] : [<ui.Text dimColor>{tokensOf(now.context.tokens)}</ui.Text>]),
    ...(now.usd === undefined ? [] : [<ui.Text color={COST}>${now.usd.toFixed(2)}</ui.Text>]),
  ]
  return <ui.Box>{segments.flatMap((one, index) => (index === 0 ? [one] : [<ui.Text dimColor> │ </ui.Text>, one]))}</ui.Box>
}

// The engine's own status-line figures, pushed after each turn and on each rate-limit move.
export const onMeasure: Hook<'session.measure'> = async ($, e, next) => {
  const model = (await read($, turnModel)) ?? (await $.session.model())
  const { tokens, percent } = e.context
  await update($, usage, () => ({ model, context: { tokens, percent }, rateLimits: [...e.rateLimits], usd: e.cost?.usd }))
  return next(e)
}

// A router (jev) swaps the model per step, so the session's own model is not the one answering: show the step's.
// shortcut: stays after /clear until the next step, reset on session.start if it shows.
export const onTurnStep: Hook<'turn.step'> = async function* ($, e, next) {
  if (e.agentId === undefined) {
    await update($, turnModel, () => e.model)
    await update($, usage, (now) => (now === null ? null : { ...now, model: e.model }))
  }
  return yield* next(e)
}
