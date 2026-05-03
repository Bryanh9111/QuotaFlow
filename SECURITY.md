# Security Policy

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Email **zhhlbaw2011@gmail.com** with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive a response within 72 hours. We will work with you to understand and address the issue before any public disclosure.

## Scope

In scope:

- **Daemon process** — privilege escalation, arbitrary code execution, sandbox escape
- **Git isolation logic** — boundary violations that touch repos outside AGENTS.md scope
- **Quota tracking** — credential leakage, session hijacking
- **Configuration** — secrets exposure, unsafe defaults

## Out of Scope

- Issues in third-party dependencies (report upstream first)
- Issues requiring physical access to the user's machine
- Social engineering attacks
- QuotaFlow is a local daemon — there is no hosted service to attack

## Disclosure Policy

Coordinated disclosure. Once a fix is released, the reporter is credited (unless anonymous is preferred) in the release notes.
