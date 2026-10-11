# lexi — rules for agents

## Every change bumps the version (mandatory)

Claude Code caches a plugin by its version: a change that does not bump it never reaches users who
already have that version. Pi follows git and does not care, but the bump is required anyway — any
commit/PR touching shipped files (`skills/`, `hooks/`, `engine/`, `pi/`, `jev/`, `mods/`, `.claude-plugin/`) includes it.

- lexi change → bump `version` in `.claude-plugin/plugin.json`, `package.json`, and in
  `.claude-plugin/marketplace.json` both `metadata.version` and the `lexi` plugin entry.
- The Jev layer and the interface live in `engine/` and ship as lexi: one bump covers them. `jev/` and `mods/` are
  deprecation stubs (bump `jev/.claude-plugin/plugin.json` or `mods/.claude-plugin/plugin.json` and their marketplace
  entries only if you touch a stub).
- Patch for fixes, minor for features. All lexi version fields must match.
- Run `python3 versions_test.py` before committing: it fails if the copies disagree.
