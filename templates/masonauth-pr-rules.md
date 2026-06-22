# masonauth PR Review Rules

## Priorities
- **authentication** — Token lifecycle, refresh flows, session invalidation.
- **authorization** — Role/permission checks on all protected endpoints.
- **tenant isolation** — Multi-tenant data must never leak across boundaries.
- **secrets management** — Key rotation, vault integration, no hardcoded secrets.
- **audit logging** — All auth events must be logged (login, logout, permission changes).
- **rate limiting** — Auth endpoints must be rate-limited.
- **OAuth/OIDC compliance** — Standards compliance for federated identity flows.

## masonauth-specific checks
- Are JWT expiration times reasonable?
- Is refresh token rotation implemented correctly?
- Are password policies enforced server-side?
- Is MFA enrollment/verification flow correct?
- Are session revocations propagated immediately?
