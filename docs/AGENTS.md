# AGENTS.md - docs/

## Responsibility

Internal engineering documentation that should stay out of public routes. Use this directory for design specs, implementation notes, and decision records that are useful to future contributors but are not end-user content.

## Directory Structure

```
docs/
└── superpowers/
    ├── specs/      Approved feature design specs before implementation planning
    └── plans/      Implementation plans derived from approved specs
```

## Module Rules

- Do not place docs under `src/pages/` or `src/content/`; those paths are routed or collected by Astro.
- Keep specs concise, decision-complete, and tied to verification criteria.
- Do not store secrets, publisher IDs, analytics IDs, account IDs, tokens, or private credentials.
- If a spec changes implementation scope, update the spec before changing code.

## Change Log

- 2026-05-11 - Added docs directory conventions for internal specs and implementation plans.
