# Lexi su KnoTic: skill e guard per l'agente nativo, plugin riusato per il runtime Claude Code (0.6.0)

**Status:** Proposed. La Fase 0 è bloccante per il percorso B.
**Versione target:** lexi 0.6.0 (minor, feature)
**Data:** 2026-09-25

## Context

lexi oggi viene distribuito come plugin Claude Code (`.claude-plugin/`, `skills/`, `hooks/hooks.json` → `hooks/tdd_guard.py`) e come pacchetto Pi (`package.json` → `pi/extensions`, `pi/skills`). L'utente vuole installarlo anche su KnoTic, partendo dall'uso locale come skill e arrivando alla duplicazione completa. In KnoTic l'utente userà **entrambi** gli agenti, il nativo e il runtime Claude Code integrato (`knotic.claudeCodePath`). Tutti e due devono avere skill, guard test-first e review Jev.

### Cosa è stato verificato nel bundle KnoTic

Fonte: `/Applications/Knotic.app`, `workbench.desktop.main.js`.

- **Skill:** vengono lette da `.knotic/skills`, `~/.knotic/skills`, `.claude/skills`, `~/.claude/skills`, `.agents/skills` e `~/.codex/skills`. Lo slug è il nome della cartella e vince il primo trovato. `description` è obbligatoria. Sono supportati `disable-model-invocation`, `user-invocable`, `argument-hint` e `allowed-tools`. L'utente invoca una skill con `/<slug>`, il modello con `invoke_skill(skill, intent)`. L'agente nativo non vede le skill dei plugin Claude.
- **Hook:** stanno in `.knotic/hooks.json`, con la forma `{version:1, hooks:[{id,label,event,actionType,command,cwd,filePattern,enabled,timeoutMs}]}`. Gli eventi sono turn_start, turn_end, on_save, pre_tool, post_tool, on_error, pre_commit, post_commit, pre_push e post_push.
  - `on_save` scatta dopo una scrittura nativa riuscita (write_file, edit_file, patch_file, delete_file, rename_file, create_directory).
  - `pre_tool` scatta solo sui tool host dei runtime esterni.
  - `pre_commit` e `pre_push` interrompono il tool git se il comando esce con codice diverso da 0.
  - Sullo stdin non arriva niente. Le uniche sostituzioni sono `${filePath}` e `${toolName}`.
  - Il timeout è di 30 secondi per hook e di 60 secondi cumulativi per evento.

### Vincoli del repository

- **Versioni (CLAUDE.md):** ogni modifica ai file distribuiti richiede un bump. Tutte le copie della versione devono coincidere, e lo controlla `versions_test.py`.
- **Gate (`.lexi.json`):** esegue `tdd_guard_test.py`, `versions_test.py`, `skills_frontmatter_test.py` e `jev/review/test_review.py`, con `testable: ["hooks/tdd_guard.py"]` e `test_suffix: _test.py`.
- **Frontmatter:** `skills_frontmatter_test.py` valida i file indicati in `PATTERNS`.
- **Regole globali:** al massimo 200 righe per file e 20 righe per funzione. `hooks/tdd_guard.py` oggi è di 178 righe.
- **Copie Pi:** `pi/skills/*` diverge già a mano da `skills/*`. Ci sono 29 riferimenti specifici del runtime in 7 file.
- **Merge dei marketplace in lexi-init (0.5.0):** è prosa in `skills/init/SKILL.md` (righe 87-105), non una funzione. Le regole sono queste: conserva tutte le altre chiavi, mantiene il `source` di una voce già presente e imposta solo `autoUpdate: true`.

## Solution

### Fase 0: verificare il runtime Claude Code in KnoTic (manuale, circa 15 minuti, bloccante per il percorso B)

1. **Plugin caricati:** le skill `/lexi:bug`, `/lexi:feature` e `/jev:code-review` sono disponibili? Una Write su un sorgente testable senza mirror viene respinta da PreToolUse?
2. **Argomenti di lancio:** controllare `--setting-sources`, `--bare` e `CLAUDE_CONFIG_DIR`. Il runtime legge `~/.claude/settings.json` e `<progetto>/.claude/settings.json`?
3. **Hook jev:** router e compattazione sono attivi?
4. **`pre_tool` di KnoTic:** può annullare il tool host?

Gli esiti vanno in `knotic/PHASE0.md` e in 'Known limits' del README.

### Percorso A: agente nativo

**A1. Skill generate.** `knotic/build_skills.py` (solo libreria standard) genera `knotic/skills/<slug>/SKILL.md` da `pi/skills/*/SKILL.md` con una tabella `SUBSTITUTIONS` esplicita:

| Pi | KnoTic |
|---|---|
| `/skill:lexi-x` | `/lexi-x` / `invoke_skill('lexi-x')` |
| `> **Pi:** …` | `> **KnoTic:** …` |
| subagente `lexi-gate` | gate inline con `run_in_terminal` |
| scout di jev-code-review | verifiche inline / `invoke_skill('explore')` |
| `pi install …` | `python3 knotic/install.py …` |

Se una sostituzione attesa non trova corrispondenze, il build fallisce. Il prefisso `lexi-` evita collisioni con le skill namespaced `lexi:*` e con `.claude/skills/code-review`.

**A2. Installazione utente.** `knotic/install.py --user [--link]` copia o collega con symlink le skill in `~/.knotic/skills/`, **mai** in `~/.claude/skills`, perché il runtime Claude Code le vedrebbe duplicate. Copia poi `tdd_guard.py`, `knotic_guard.py`, `jev/review/` e VERSION in `~/.knotic/lexi/`.

**A3. Guard.** Il refactoring di `hooks/tdd_guard.py` non cambia il comportamento. Estrae una funzione pura, `verdict(cfg, cwd, rel, is_insertion) -> str | None`. `main()` mantiene il contratto stdin per Claude e Pi.

`hooks/knotic_guard.py` riusa `load_config`, `to_rel` e `verdict`, e ha due modalità:

- **`--saved "${filePath}" ${toolName}`** (on_save): ricostruisce l'inserimento puro da `git diff -U0`. Se trova una violazione esce con codice 2 e aggiunge una riga a `.lexi/knotic-violations`.
- **`--staged`** (pre_commit): valuta i file staged e blocca il commit fatto con il tool git.

Se git fallisce, il guard non blocca, come già fa `git_tracks`.

### Percorso B: runtime Claude Code

- **B1:** la Fase 0 va a buon fine. Non serve codice nuovo: il plugin porta PreToolUse, le skill `lexi:*` e `jev:code-review`, e router e compattazione se il punto 0.3 lo conferma.
- **B2:** manca solo la configurazione. `install.py --project <path>` unisce in `<path>/.claude/settings.json`:
  - `extraKnownMarketplaces.lexi` (github `savinofiore/lexi`, `autoUpdate: true`);
  - `enabledPlugins` `lexi@lexi` e `jev@lexi`.

  Applica le stesse regole di lexi-init: conserva le altre chiavi e il `source` già presente.
- **B3:** il runtime ignora plugin e settings (ad esempio con `--bare`). Diventa un limite noto: resta solo pre_commit, più `lexi-guard-pretool` se il punto 0.4 conferma che `pre_tool` può annullare il tool.

### Parti comuni

- **C1. Hook del progetto.** `install.py --project` unisce per id in `.knotic/hooks.json`, in modo idempotente:
  - `lexi-guard-save` (on_save, `filePattern` sui sorgenti letti da `.lexi.json`);
  - `lexi-guard-commit` (pre_commit).

  Conserva gli hook dell'utente, usa path assoluti verso `~/.knotic/lexi/`, mette `${filePath}` tra virgolette e imposta `timeoutMs` a 10000. La lexi-init per KnoTic lo esegue dopo aver scritto `.lexi.json`.
- **C2. Nessun doppio guard.** on_save riguarda solo le scritture native, PreToolUse solo quelle di Claude Code. pre_commit è condiviso ed è idempotente.
- **C3. Anti-deriva.** `knotic_skills_sync_test.py` rigenera le skill e le confronta con quelle su disco. `knotic/skills/*/SKILL.md` entra nei `PATTERNS` del test sul frontmatter.
- **C4. Versioni.** `knotic/manifest.json` entra in `versions_test.py`. La versione passa a 0.6.0 ovunque. `knotic` si aggiunge a `files` in `package.json` e `knotic/` all'elenco dei file distribuiti in CLAUDE.md.
- **C5. `--git-hook` (opzionale, disattivato di default).** Scrive `.git/hooks/pre-commit` solo se non esiste già un hook, per rispettare husky e lefthook.

### Decisioni aperte (si applicano i default)

- **Q2, parità:** l'agente nativo ha solo una parte delle funzioni. La parità passa dal runtime Claude Code.
- **Q3, hook git reale:** opzionale, con `--git-hook`.
- **Q4, sorgente delle skill:** generate da `pi/skills`. L'inversione della sorgente è rimandata.
- **Q5, rilascio:** un solo rilascio 0.6.0, installato con clone più `install.py`.

### Fuori scope per l'agente nativo

- Router e compattazione Jev (`jev/hooks/router.ts`, `compact.ts`, `pi/extensions/jev-*`).
- Caveman (`pi/extensions/caveman.ts`).

Gli hook di KnoTic non possono cambiare modello, gestire la compattazione o iniettare nel system prompt.

## Trade-offs

**Pro**

- Copre entrambi gli agenti, ognuno con il meccanismo che KnoTic gli mette a disposizione.
- Per il runtime Claude Code riusa il plugin esistente, senza codice nuovo se la Fase 0 va bene.
- Le due superfici non si sovrappongono: `lexi-*` contro `lexi:*`, on_save contro PreToolUse.
- La logica del guard resta unica (`verdict`). Le copie KnoTic sono generate e controllate nel gate.

**Contro**

- Sull'agente nativo il guard è solo rilevativo, perché avvisa dopo la scrittura. Su Claude Code invece blocca prima.
- Il percorso B dipende da come KnoTic lancia il binario Claude Code, un dettaglio interno che può cambiare.
- Il runtime Claude Code committa con Bash e salta il pre_commit di KnoTic. Lo copre solo `--git-hook`.
- L'inserimento puro ricostruito dal diff git è meno preciso di `old_string` e `new_string`.
- Due percorsi di installazione vuol dire più documentazione e più verifiche a ogni rilascio.
- Le API di KnoTic sono interne e non documentate.

**Alternative scartate**

- **Solo runtime Claude Code:** l'agente nativo non vede le skill dei plugin.
- **Skill in `~/.claude/skills`:** il runtime Claude Code le vedrebbe duplicate.
- **Copia manuale delle skill:** aumenta la deriva.
- **Sorgente unica subito:** allarga troppo la PR.
- **Hook git di default:** rischia conflitti con husky e lefthook.

## Action Plan

1. **Fase 0 (manuale).** Eseguire le verifiche 0.1-0.4 descritte sopra, scrivere `knotic/PHASE0.md` e scegliere B1, B2 o B3.
2. **Refactoring di `hooks/tdd_guard.py`.** Estrarre `verdict()`, aggiungere i casi in `hooks/tdd_guard_test.py` e tenere verdi i test esistenti. Il file resta sotto le 200 righe.
3. **RED: `hooks/knotic_guard_test.py`.** Seam: un repository git temporaneo con `.lexi.json`. Casi `--saved`:
   - testable senza mirror → 2 e una riga in `.lexi/knotic-violations`;
   - test tracciato riscritto → 2;
   - solo righe `+` → 0;
   - test nuovo → 0;
   - senza config → 0;
   - `LEXI_OFF` → 0;
   - allowlist → 0.

   Casi `--staged`: violazione → 2, indice pulito → 0.
4. **GREEN: `hooks/knotic_guard.py`.** Aggiungerlo a `testable` e il suo test al `gate` in `.lexi.json`.
5. **`knotic/build_skills.py`.** Generare le 7 skill in `knotic/skills/`: `lexi-bug`, `lexi-feature`, `lexi-grill`, `lexi-init`, `lexi-lexi`, `lexi-tdd` e `jev-code-review`. Aggiornare `lexi-init` perché lanci `install.py --project`.
6. **Anti-deriva.** Creare `knotic_skills_sync_test.py` e aggiungerlo al gate. Aggiungere `knotic/skills/*/SKILL.md` ai `PATTERNS` di `skills_frontmatter_test.py`.
7. **`knotic/install.py` e `knotic/install_test.py`.** Implementare `--user [--link]`, `--project <path>` (hooks.json e `.claude/settings.json`) e `--git-hook`. Test su una HOME temporanea:
   - idempotenza;
   - hook dell'utente conservati;
   - `source` già presente conservato;
   - nessuna scrittura in `~/.claude/skills`.
8. **`pre_tool` (condizionale).** Aggiungere `lexi-guard-pretool` solo se la verifica 0.4 lo conferma.
9. **Versioni 0.6.0.**
   - Creare `knotic/manifest.json`.
   - Aggiornare `versions_test.py`, `.claude-plugin/plugin.json`, `package.json` (versione e `files`) e `.claude-plugin/marketplace.json` (`metadata.version` e la voce `lexi`).
   - Aggiungere `knotic/` all'elenco dei file distribuiti in `CLAUDE.md`.
   - Eseguire `python3 versions_test.py`.
10. **README.** Aggiungere 'Install — KnoTic', la tabella per funzione e per agente e la sezione 'Known limits'.

## Verification

1. **Gate:** eseguire il gate completo definito in `.lexi.json`, che include `hooks/knotic_guard_test.py`, `knotic/install_test.py` e `knotic_skills_sync_test.py`. Deve passare tutto.
2. **Installazione:** eseguire `python3 knotic/install.py --user --link && python3 knotic/install.py --project <progetto-di-prova>`.
3. **Agente nativo in KnoTic:**
   - `/lexi-feature` compare tra le skill;
   - la scrittura di un sorgente testable senza mirror produce l'avviso on_save e una riga in `.lexi/knotic-violations`;
   - un commit con il tool git viene bloccato.
4. **Runtime Claude Code in KnoTic:**
   - `/lexi:feature` compare tra le skill e `/lexi-feature` no;
   - la stessa scrittura viene respinta da PreToolUse.
5. **Idempotenza:** eseguire di nuovo `--project` e verificare che `git diff` su `.knotic/hooks.json` e `.claude/settings.json` sia vuoto.