---
name: security-review
description: Run a security review pass on code changes — check for secrets, injection vulnerabilities, auth/authz issues, unsafe input handling, sensitive data exposure, and dependency vulnerabilities. Activate automatically when doing a pr-review, or when asked to review security.
---

# Security Review

A focused security pass over code changes. Work through each category below and flag any issues found.

## 1. Secrets & credentials

- No hardcoded API keys, tokens, passwords, or connection strings in source code
- All secrets loaded from environment variables
- No secrets committed to git history
- `.env*` files in `.gitignore`

## 2. Input validation & injection

- User-supplied input validated before use (type, length, format)
- No string concatenation in database queries — parameterized queries or ORM only
- No unsanitized user input passed to shell commands (`exec`, `spawn`, `child_process`)
- No unsanitized user input used in file paths or file operations
- No prototype pollution via `Object.assign` or similar with untrusted input

## 3. Authentication & authorization

- Auth checks happen before the operation, not after
- No missing auth on endpoints that should be protected
- No role/permission checks that can be bypassed via parameter tampering
- Tokens stored securely (httpOnly cookies, not localStorage or URL params)
- Session invalidated on logout

## 4. Sensitive data exposure

- No passwords, tokens, or PII in logs
- Error messages returned to clients are generic — stack traces and internal details stay server-side
- Sensitive fields excluded from serialized API responses
- No secrets in error messages, issue bodies, PR descriptions, or Slack replies

## 5. Dependency vulnerabilities

```bash
# Check for known vulnerabilities
npm audit

# Review newly added packages
gh pr diff {number} -R {owner}/{repo} -- package.json package-lock.json
```

Flag any `npm audit` high/critical findings or newly added packages with known issues.

## 6. Additional checks (when applicable)

- **File uploads**: validate MIME type, extension, and size — never trust client-supplied type
- **CORS**: not set to `*` on endpoints that use cookies or tokens
- **Rate limiting**: present on expensive or sensitive endpoints
- **XSS**: user-provided HTML/content sanitized before rendering

## Reporting findings

Group findings by severity:

- **Critical** — exploitable now (e.g. hardcoded secret, SQL injection, missing auth)
- **High** — likely exploitable with effort (e.g. missing input validation on sensitive path)
- **Medium** — exploitable under specific conditions
- **Low** — defense-in-depth improvement (e.g. missing rate limit on low-value endpoint)

For each finding, reference the exact file and line. Suggest a concrete fix.

If no issues are found, explicitly state: "No security issues found."
