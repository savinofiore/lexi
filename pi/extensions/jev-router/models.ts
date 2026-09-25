export type ProviderModel = { provider: string; id: string }

// `provider/id` is exact. A bare id stays on the session's provider and picks the newest model of its
// family there, so the default `claude-opus-5-5` lands on claude-bridge/claude-opus-5 for a bridge
// session instead of the metered `anthropic` provider.
export function resolveTarget<T extends ProviderModel>(models: T[], provider: string | undefined, target: string): T | undefined {
  if (target.includes('/')) {
    const [targetProvider, ...rest] = target.split('/')
    const id = rest.join('/')
    return models.find((model) => model.provider === targetProvider && model.id === id)
  }
  const family = familyOf(target)
  return models
    .filter((model) => model.provider === (provider ?? 'anthropic') && familyOf(model.id) === family)
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0]
}

// claude-opus-5-5 → claude-opus; claude-sonnet-4-5-20250929 → claude-sonnet
export const familyOf = (id: string) => id.replace(/[-\d]+$/, '')
