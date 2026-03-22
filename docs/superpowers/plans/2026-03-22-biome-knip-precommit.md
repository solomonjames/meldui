# Biome Migration, Knip Dead Code Removal & Pre-commit Hook

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ESLint with Biome for faster linting, add Knip to find/remove dead code, and add a pre-commit hook that runs lint + format + type checks.

**Architecture:** Biome replaces ESLint as the single lint+format tool. Knip runs as a one-shot cleanup pass to remove dead exports/files/deps. A git pre-commit hook (via `lefthook`) runs Biome and TypeScript checks on staged files before each commit.

**Tech Stack:** Biome, Knip, Lefthook

---

## File Structure

| Action | File | Purpose |
|--------|------|---------|
| Create | `biome.json` | Biome config (replaces `eslint.config.js`) |
| Delete | `eslint.config.js` | Replaced by Biome |
| Create | `lefthook.yml` | Pre-commit hook config |
| Modify | `package.json` | Swap ESLint deps for Biome + Knip + Lefthook, update `lint` script |
| Modify | `.github/workflows/ci.yml` | Update lint step from ESLint to Biome, add Biome format check |
| Modify | `CLAUDE.md` | Update lint commands |
| Various | Source files | Fix any Biome-specific lint issues, remove dead code found by Knip |

---

## Task 1: Install and Configure Biome

**Files:**
- Create: `biome.json`
- Modify: `package.json`

- [ ] **Step 1: Install Biome**

Run:
```bash
bun add -d @biomejs/biome
```

- [ ] **Step 2: Create `biome.json` config**

First, run `bunx biome init` to generate a baseline config and confirm the installed schema version. Then replace its contents with:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.6/schema.json",
  "files": {
    "ignore": [
      "dist",
      "src-tauri/target",
      "e2e",
      "src/agent",
      "src/bindings.ts",
      "node_modules"
    ]
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "useExhaustiveDependencies": "warn",
        "noUnusedImports": "error"
      },
      "nursery": {
        "useComponentExportOnlyModules": "warn"
      },
      "style": {
        "noNonNullAssertion": "off"
      }
    }
  },
  "overrides": [
    {
      "includes": ["src/shared/ui/**"],
      "linter": {
        "rules": {
          "nursery": {
            "useComponentExportOnlyModules": "off"
          }
        }
      }
    }
  ],
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always"
    }
  },
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  }
}
```

Notes:
- `noNonNullAssertion` is off because the codebase uses `null!` in context defaults (standard React pattern). The `useExhaustiveDependencies` matches the current ESLint react-hooks rule severity.
- **React Refresh rule preserved**: Biome's built-in `useComponentExportOnlyModules` (nursery) replaces ESLint's `react-refresh/only-export-components`. Disabled for `src/shared/ui/**` (shadcn components export non-component items).
- Update the `$schema` version to match what `bunx biome init` generates if different from `2.0.6`.

- [ ] **Step 3: Run Biome to verify it works**

Run:
```bash
bunx biome check src/
```

Expected: Output showing lint results. May have some findings — that's fine, we'll fix them in the next step.

- [ ] **Step 4: Auto-fix what Biome can fix**

Run:
```bash
bunx biome check --fix src/
```

Expected: Auto-fixes applied. Review the changes with `git diff` to confirm they're safe.

- [ ] **Step 5: Fix any remaining Biome errors manually**

Review the output of `bunx biome check src/` after auto-fix. Address any remaining errors that couldn't be auto-fixed. These are typically:
- Unused imports (Biome catches more than ESLint)
- React hook dependency issues

Run `bunx biome check src/` again to confirm zero errors.

- [ ] **Step 6: Commit**

```bash
git add biome.json src/
git commit -m "feat: add Biome config and fix lint issues"
```

---

## Task 2: Remove ESLint

**Files:**
- Delete: `eslint.config.js`
- Modify: `package.json`

- [ ] **Step 1: Remove ESLint packages**

Run:
```bash
bun remove eslint @eslint/js eslint-plugin-react-hooks eslint-plugin-react-refresh globals typescript-eslint
```

- [ ] **Step 2: Update the `lint` script in `package.json`**

Change `package.json` scripts:
```json
"lint": "biome check src/",
"lint:fix": "biome check --fix src/",
"format": "biome format --write src/",
"format:check": "biome format src/",
```

- [ ] **Step 3: Delete `eslint.config.js`**

Run:
```bash
rm eslint.config.js
```

- [ ] **Step 4: Verify lint still works**

Run:
```bash
bun run lint
```

Expected: Clean output (no errors).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lockb eslint.config.js
git commit -m "refactor: replace ESLint with Biome for linting"
```

---

## Task 3: Run Knip to Find Dead Code

**Files:**
- Modify: `package.json` (add knip dev dep)
- Various source files (remove dead code)

- [ ] **Step 1: Install Knip**

Run:
```bash
bun add -d knip
```

- [ ] **Step 2: Run Knip to see what's unused**

Run:
```bash
bunx knip
```

Expected: Report of unused files, exports, dependencies, and types. Review each category.

- [ ] **Step 3: Triage findings**

For each finding, decide:
- **Unused exports**: Remove the `export` keyword (keep the function/type if used locally) or delete entirely if unused
- **Unused files**: Delete if truly dead
- **Unused dependencies**: Remove with `bun remove <pkg>`
- **False positives**: Add to Knip ignore in `package.json` if needed:

```json
"knip": {
  "ignore": ["src/bindings.ts"],
  "ignoreDependencies": ["@tauri-apps/cli"]
}
```

Note: `src/bindings.ts` is auto-generated and `@tauri-apps/cli` is used via `tauri` CLI, not imports. These are expected false positives.

- [ ] **Step 4: Apply the removals**

Remove dead code identified in step 3. Work through one category at a time:
1. Unused dependencies first (`bun remove ...`)
2. Unused exports (remove `export` keyword or delete)
3. Unused files (delete)

After each category, run `bun run lint` and `npx tsc --noEmit` to verify nothing broke.

- [ ] **Step 5: Add a `knip` script for future use**

In `package.json` scripts:
```json
"knip": "knip"
```

- [ ] **Step 6: Run Knip again to confirm clean**

Run:
```bash
bunx knip
```

Expected: No findings (or only expected false positives covered by ignore config).

- [ ] **Step 7: Commit**

Review what changed before staging:
```bash
git status
```

Then stage and commit:
```bash
git add -A
git commit -m "refactor: remove dead code identified by Knip"
```

---

## Task 4: Add Pre-commit Hook with Lefthook

**Files:**
- Create: `lefthook.yml`
- Modify: `package.json`

- [ ] **Step 1: Install Lefthook**

Run:
```bash
bun add -d @evilmartians/lefthook
```

- [ ] **Step 2: Create `lefthook.yml`**

```yaml
pre-commit:
  parallel: true
  commands:
    biome-check:
      glob: "*.{ts,tsx,js,jsx,json}"
      run: bunx biome check --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}
    typecheck:
      glob: "*.{ts,tsx}"
      run: npx tsc --noEmit
    rust-fmt:
      glob: "*.rs"
      run: cd src-tauri && cargo fmt -- --check
```

Design decisions:
- `parallel: true` — lint and typecheck run concurrently for speed
- `biome-check` runs on staged files only (fast)
- `typecheck` runs full project (necessary since TS checks cross-file)
- `rust-fmt` only runs when Rust files change

- [ ] **Step 3: Install the git hook**

Run:
```bash
bunx lefthook install
```

Expected: Creates `.git/hooks/pre-commit` pointing to lefthook.

- [ ] **Step 4: Add a `prepare` script so hooks install on clone**

In `package.json` scripts:
```json
"prepare": "lefthook install"
```

- [ ] **Step 5: Test the pre-commit hook without creating a throwaway commit**

Run the hook manually:
```bash
bunx lefthook run pre-commit
```

Expected: All three checks (biome-check, typecheck, rust-fmt) pass.

- [ ] **Step 6: Commit the hook config**

```bash
git add lefthook.yml package.json bun.lockb
git commit -m "feat: add pre-commit hook with Biome lint, typecheck, and Rust fmt"
```

---

## Task 5: Update CI and Documentation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CI lint step**

In `.github/workflows/ci.yml`, in the `frontend-lint` job, replace:
```yaml
      - name: Lint (ESLint)
        run: bun run lint
```

With:
```yaml
      - name: Lint (Biome)
        run: bun run lint

      - name: Format check (Biome)
        run: bun run format:check

      - name: Dead code check (Knip)
        run: bun run knip -- --reporter github-actions
```

The `--reporter github-actions` flag adds inline PR annotations for any unused exports/deps/files found.

Also update the `detect-changes` paths filter — replace `eslint.config.js` with `biome.json`:
```yaml
            frontend:
              - 'src/**'
              - '!src/agent/**'
              - 'tsconfig*.json'
              - 'vite.config.ts'
              - 'vitest.config.ts'
              - 'biome.json'
              - 'components.json'
              - 'index.html'
              - 'scripts/**'
```

- [ ] **Step 2: Update CLAUDE.md**

In the `Build & Development Commands` section, update:

```bash
# Lint
bun run lint                        # Biome (lint)
bun run lint:fix                    # Biome (lint + auto-fix)
bun run format:check                # Biome (format check)
bun run format                      # Biome (format + write)

# Dead code detection
bun run knip                        # Find unused files/exports/deps

# Rust formatting
cd src-tauri && cargo fmt -- --check
```

Also add to the Key Patterns section:

```
**Pre-commit hook**: Lefthook runs `biome check` on staged files, `tsc --noEmit` for type checking, and `cargo fmt --check` for Rust files. Runs automatically on commit. Install with `bunx lefthook install` (also runs via `prepare` script on `bun install`).
```

- [ ] **Step 3: Verify everything works end-to-end**

Run:
```bash
bun run lint && bun run format:check && bun run knip && npx tsc --noEmit && bun run test
```

Expected: All pass with zero errors.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml CLAUDE.md
git commit -m "docs: update CI and CLAUDE.md for Biome migration"
```
