# Context

**Current Task**: Plan 3 (apps/web) is done, merged into `main` and pushed to origin (004f2d2).

**Key Decisions**
- Origin is git@github.com:parthgod/riff.git (SSH); commits carry no Co-Authored-By trailer.
- Final Opus review: 7 Important findings fixed test-first; minors from Plans 1–3 logged in `docs/superpowers/deferred-issues.md`.
- e2e signs up 3 times, the limit of Better Auth's 3-per-10 s production sign-up rate limit; new e2e tests must reuse a sign-up.

**Next Steps**
- Real-device check on iOS Safari (first play after the stream fetch; autoplay rules).
- Next: the spec's v1.1 roadmap (offline, gapless, EQ, import) or v2 Expo app; decide on the offline-failover policy.
