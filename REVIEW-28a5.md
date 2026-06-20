# Review: Phase 28a.5 Status Tracker

Reviewed: 2026-06-11T16:45:00Z
Reviewer: ijfw-review
Domain: software

## Summary

Phase 28a.5 delivers solid PR polling with retry logic and caching, but has 3 critical issues: rate limit check unreachable (fires after 400+ rejection), missing null handling on pr.head.sha, and unsafe endpoint parsing. Review state detection assumes chronological ordering but GitHub doesn't guarantee it. Tests cover happy path and caching well; missing edge case for cache invalidation on partial failures.

## BLOCK findings (must-fix)

- `status-tracker.ts:362-376`: Rate limit check (429) unreachable. Condition `if (res.statusCode >= 400)` at line 362 rejects all 4xx errors before reaching `if (res.statusCode === 429)` at line 370. Move 429 check before the 400 gate.
- `status-tracker.ts:86`: Null pointer on pr.head.sha. Code accesses pr.head.sha without optional chaining; if GitHub API returns missing head object, this throws. Use `pr.head?.sha || commitSha` with fallback.
- `status-tracker.ts:339`: Unsafe endpoint parsing. `endpoint.split(" ")` assumes "METHOD /path" format but doesn't validate. If endpoint is malformed, method/path become undefined. Validate length >= 2 or use regex split.

## FLAG findings (should-discuss)

- `status-tracker.ts:214-220`: Review state assumes chronological ordering. Code takes `reviews[reviews.length - 1]` as "last review," but GitHub API may not order reviews by time. Should iterate through reviews tracking latest APPROVED vs CHANGES_REQUESTED state explicitly.
- `status-tracker.ts:360`: Unbounded JSON parsing. No max length check before `JSON.parse(data)`. Malicious/corrupted responses could OOM. Add `if (data.length > 10MB) reject()` check.
- `status-tracker.ts:101-104`: Cache stale after partial failures. If getPRWithRetry succeeds but getReviewStateWithRetry fails mid-way, stale snapshot gets cached forever. Cache should only be set after all 3 API calls succeed.
- `status-tracker.ts:191-192`: Unreachable code. Line 192 `throw new Error("Max retries exceeded")` unreachable; while loop always exits via throw at line 178/188. Remove dead code.
- `status-tracker.ts:313-321`: Unbounded query. `LIMIT 50` hardcoded; if skill has 51+ open PRs, silently ignores. Should paginate or log warning.

## NIT findings (polish)

- `status-tracker.test.ts:111`: Test assertion overly strict. `expect(jest.spyOn(...)).not.toHaveBeenCalled()` spies on already-spied method; reuse `jest.fn().mockResolvedValue()` pattern instead for clarity.
- `skill-status.ts:30-31`: Inconsistent null/undefined handling. `manifest Service.getSkillById()` returns null, but tests assume it throws. Clarify contract in code comment.
- `status-tracker.ts:17`: Log function uses `prNumber: number` but some calls pass `0` (batch ops). Either use optional prNumber or clarify "0 means skill-level log."

## Non-findings

✅ Retry with exponential backoff correct (delay *= 2 pattern)
✅ Cache TTL logic correct (5-minute window)
✅ Error propagation non-fatal on DB write (correct for audit logs)
✅ Batch operation resilience (continues on per-PR failures)
✅ Type safety comprehensive (ReviewState enum, PRStatusSnapshot)
✅ Offline graceful degradation (review state defaults to "none")
✅ Test coverage adequate (14 tests, caching, batch ops, error paths)

