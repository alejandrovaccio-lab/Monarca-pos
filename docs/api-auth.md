# Monarca POS — Authentication API

The authentication API is framework-neutral at this stage so domain security rules are not coupled to a web framework.

## POST /auth/login
Request fields: email, password, optional branchId.
Responses: 200 session created; 400 malformed request; 401 invalid credentials; 403 no branch access; 409 branch selection required.

## GET /auth/me
Requires the session token and returns the authenticated user, active branch and roles.

## POST /auth/logout
Requires the session token and revokes the active session.

## Security
- Passwords are never returned.
- Only active users can authenticate.
- Branch access is checked server-side.
- Sessions expire and can be revoked.
- Unauthorized branch selection is rejected server-side.
- The eventual HTTP adapter should prefer a secure, HttpOnly, SameSite cookie for browser sessions.