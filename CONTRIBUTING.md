# Contributing to forgeax-wb-node-core

## Quick start

```bash
# Replace <internal-host> with your team's git host (see the team README;
# `git remote -v` after your first clone reports the real URL).
git clone git@<internal-host>:dev/forgeax-wb-node-core.git
cd forgeax-wb-node-core
pnpm install
pnpm build
pnpm test
```

## Layout

This is a pnpm monorepo. Each `packages/<pkg>` is independently versioned and published.

```
packages/
├── node-runtime/         Layer 1 (headless) + Layer 2 (editing API)
├── node-runtime-react/   Layer 3 (UI components)
├── node-runtime-cli/     forgeax CLI binary
└── i18n/                 ICU MessageFormat zh/en
```

## Coding conventions

- TypeScript `strict: true`. No `any` without justification (lint warns).
- Files end with newline. No trailing whitespace.
- Comments and identifiers in English. The only exception is i18n message catalogs.
- Public API: every export gets a JSDoc one-liner explaining intent.

## Hygiene policy

The repository forbids three upstream-brand / vendor-internal terms in any
tracked source or doc file (the literals are written here with split
character classes so this rule does not flag itself):
`g[r]asshopper`, `d[e]vcloud`, `t[e]ncent`.

`package.json`, `pnpm-lock.yaml`, and `.npmrc` are exempt because their
git URL fields legitimately contain the host name.

The check runs in `.husky/pre-commit` and in CI. If the test fails:

1. Search and replace the offending occurrence with neutral wording.
2. If a literal match comes from a configuration value (e.g. an internal git URL),
   parameterise it via env var or replace with `<host>` placeholder.
3. The hygiene script itself uses split character-classes (`g[r]asshopper`) so
   it does not match its own source.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org), English only:

```
<type>(<scope>): <imperative summary>

[optional body explaining why, not what]

[optional footer: BREAKING CHANGE / Refs / etc]
```

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`.

## Pull request checklist

- [ ] Hygiene check passes (`pnpm hygiene`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Type check passes (`pnpm typecheck`)
- [ ] Tests added or updated; all green (`pnpm test`)
- [ ] CHANGELOG entry under `## Unreleased` (use `pnpm changeset` once Changesets is wired up)
- [ ] If the change touches the public API surface of a package, semver impact noted

## Releases

Tag-driven. Each release is `vX.Y.Z` from `main`. `prepare` script builds
artefacts so plugin repositories that consume via git URL get `dist/` on
install.
