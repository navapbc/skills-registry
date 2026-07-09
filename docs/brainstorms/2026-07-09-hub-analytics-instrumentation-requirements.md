# Hub Analytics Instrumentation — Requirements

**Date:** 2026-07-09
**Status:** Ready for planning
**Source:** [Issue #18](https://github.com/navapbc/skills-registry/issues/18) — [Analytics][P0-1] Instrument Hub with pageview + event logging
**Scope tier:** Standard

---

## Problem

The Hub has no behavioral event instrumentation. Product questions like *"which skills get the most views"*, *"what are people searching for"*, and *"which filters get used"* cannot be answered at all today.

Note: *"how many unique employees visited in the last N days"* is **already roughly answerable** — the admin dashboard derives active / new / returning / dormant users from the `users` table's `created_at` + `last_seen_at` via `userSegments()` in `src/lib/admin/format.mjs`. The genuinely missing capability is **content-level analytics**, not user-activity counts.

## Goal

Capture behavioral events from the (static) frontend and surface the new content-analytics metrics in the existing admin dashboard, without disturbing the working user-activity metrics or the security audit trail.

## Users

- **Primary:** Hub admins (role `admin`) who read the admin dashboard to understand what content is used.
- **Instrumented:** all authenticated `@navapbc.com` users, whose in-app actions generate events.

---

## Decision: Approach A — separate events table + content metrics

Chosen over reusing the audit-log table (B) and over recomputing all metrics from events (C).

- **A** builds event capture + a dedicated `analytics-events` store + new admin panels, and leaves the existing `last_seen_at`-based user metrics untouched.
- **A is the first phase of C.** The expensive/irreversible parts (client capture, ingest endpoint, raw event storage) are identical in A and C. Switching to C later is a **read-side-only** change — repoint `userSegments()` at the event stream — with no re-instrumentation and no migration of going-forward data. A starts collecting immediately, so the historical backlog C would need accrues in the meantime.
- **B rejected:** behavioral volume (page views) would swamp the security audit trail and flood the admin "Recent Activity" feed; audit wants keep-forever while analytics may not; query shapes differ (aggregate-by-skill vs by-resource).

## Events in scope

Every event carries `user_email` (stamped **server-side** from the JWT at ingest — no client-supplied identity) and `timestamp`.

| Event | Trigger | Properties |
|---|---|---|
| `page_view` | Any Hub page loads | `path`, `referrer` |
| `skill_view` | Skill **detail page** loads (not a browse-list card impression) | `skill_id`, `skill_slug`, `referrer` (browse / search / direct) |
| `search_query` | User submits a search | `query`, `result_count` |
| `filter_applied` | User applies a category/surface filter | `filter_name`, `filter_value` |

### Dropped from the issue's list

- **`session_start`** — **out of scope.** No current or planned metric consumes a session count. A 30-min-inactivity session is derivable at query time from the `page_view` stream if a session metric is ever needed. Emitting it as a stored event would require client-side session tracking (inactivity timers in `localStorage`) for data we can already compute — speculative complexity.

## Admin surface (content analytics)

Add new panels to the admin dashboard (`src/scripts/admin/dashboard.mjs`) for the newly-available data, windowed (e.g. last 28d to match the existing active-user window):

- **Top viewed skills** — from `skill_view`.
- **Top searches** — from `search_query` (query + result_count).
- **Filter usage** — from `filter_applied`.

Existing user-activity metrics (total / active / new / returning / dormant) stay as-is, sourced from `last_seen_at`.

---

## Success criteria

- The four events fire from the static frontend and land in storage with a server-stamped `user_email` and `timestamp`.
- An admin can answer *"which skills were viewed most in the last 28 days"* and *"what did people search for"* from the dashboard.
- The security audit log and its "Recent Activity" feed are unaffected by analytics volume.
- Existing user-activity metrics are unchanged.

## Non-goals

- `session_start` / session-count metrics.
- Recomputing user-activity metrics from events (that is upgrade path C).
- Any SSO / auth work — `user_email` is already on `ctx.user` for every `/api/*` request.
- Exposing analytics outside the admin dashboard (no external BI export, no per-user-facing analytics).

## Data / retention decision

- **Raw per-user event rows are kept indefinitely** — no TTL. Volume is low (internal tool, dozens–hundreds of users) and this keeps content metrics computable over any window without pre-aggregation.
- All users are `@navapbc.com`; per-user behavioral history is queryable by admins. This is an accepted, conscious tradeoff for an internal tool. Revisit if the Hub ever serves external users.

## Dependencies / assumptions

- **[Verified]** Frontend is fully static (`output: 'static'` in `astro.config.mjs`); pages client-fetch `/api/*`. Therefore all events are captured **client-side** and POSTed to a new ingest route.
- **[Verified]** `user_email` (= `user_id`) is available server-side via `ctx.user` on every authenticated `/api/*` request (`functions/api/middleware/auth.mjs`), so the ingest endpoint stamps identity from the JWT rather than trusting the client. Issue's "no SSO work needed" assumption holds.
- **[Verified]** A new DynamoDB table is created via Terraform (`terraform/dynamodb.tf` + IAM grant in `terraform/iam.tf`) and requires a manual `terraform apply` per environment (staging state, then prod state). CI deploys Lambda/S3 only, not infra.
- **[Assumption]** Existing `writeAudit()` / audit-log table (`functions/api/lib/audit.mjs`) stays reserved for security/mutation events only; analytics does not write to it.

## Deferred to planning (ce-plan)

Not decided here — belongs to implementation:
- Exact table key schema and GSIs for the metric query patterns.
- Ingest route shape, batching vs per-event, `sendBeacon` vs `fetch`, error handling.
- Query/aggregation strategy for the admin panels (scan+aggregate vs GSI vs pre-agg).
- Client instrumentation wiring points per page.

## Future upgrade path (C)

When analytics becomes first-class: recompute active / new / returning / dormant from the event stream (read-side change to `userSegments()`), enabling engagement-based "active" (not just an API ping) and cohort/funnel analysis. No new capture work required — A's data feeds it.
