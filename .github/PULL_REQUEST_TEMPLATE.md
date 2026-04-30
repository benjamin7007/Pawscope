<!-- Thanks for sending a PR! Pawscope is small and opinionated — please keep changes focused. -->

## Summary

<!-- One or two sentences. What does this change and why? -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] New / updated adapter (Claude / Copilot / Codex / new agent)
- [ ] UI / dashboard change
- [ ] Refactor / internal cleanup (no behavior change)
- [ ] Docs / README / install scripts
- [ ] Build / CI / release plumbing

## Related issues

<!-- e.g. Closes #12, Refs #34 -->

## How was this tested?

<!--
Pick whatever applies and add details:
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cd web && npm run build && npm run lint`
- Ran `pawscope serve` locally and clicked through ____
- Added new tests in ____
-->

## Screenshots (UI changes)

<!-- Drag in before/after PNGs. Make sure they don't contain real session data, prompts, repo names, paths, or chat content. -->

## Checklist

- [ ] No real session data, prompts, paths, or secrets in code/tests/screenshots
- [ ] Read-only / local-only invariants preserved (no writes to agent session files, no outbound network from the dashboard)
- [ ] `cargo test` passes locally
- [ ] `cargo clippy -- -D warnings` is clean
- [ ] Web dashboard still builds (`cd web && npm run build`) if the FE was touched
- [ ] Updated README / CHANGELOG if user-visible behavior changed
