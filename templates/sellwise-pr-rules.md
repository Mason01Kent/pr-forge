# SellWise PR Review Rules

## Critical priorities (in order)
1. **authentication** — Any auth flow changes must be reviewed for session safety and token handling.
2. **authorization** — Verify ownership checks on all resource access.
3. **ownership isolation** — Users must only see/edit their own data. Check tenant/org boundaries.
4. **centralized money/profit logic** — All financial calculations must go through shared services, never inline.
5. **inventory transactions** — Stock changes must be atomic and auditable.
6. **refunds** — Refund logic must be idempotent and not allow duplicate refunds.
7. **PostgreSQL migrations** — Migrations must be backward-compatible. No destructive changes without rollback.
8. **production readiness** — Logging, monitoring, feature flags, graceful degradation.
9. **secrets/config safety** — No secrets in code. Config must be environment-scoped.
10. **tests and rollback risk** — Adequate test coverage. Rollback plan documented.

## SellWise-specific checks
- Does the change affect the profit calculation pipeline?
- Are inventory adjustments properly isolated per tenant?
- Do migration scripts handle large tables safely (no table locks)?
- Are API responses properly scoped to the authenticated user's organization?
- Is money always represented as `decimal`, never `float`/`double`?
