# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| latest main | Yes |
| older releases | Best effort |

## Reporting a Vulnerability

Do not report security vulnerabilities through public GitHub Issues.

Please contact the repository owner privately or open a temporary GitHub Security Advisory.

When reporting, include:

- affected version or commit hash
- reproduction steps
- impact assessment
- proof of concept if available
- suggested fix

We will respond as soon as possible.

## Security Boundaries

This application intentionally follows these rules:

- No central application backend.
- API keys are stored locally only.
- Electron uses context isolation and disables Node integration.
- Plugins run in a sandbox with timeout and output limits.
- The TDX bridge is read-only for market data and never submits orders.
- User files are stored locally and are not uploaded to the application's own servers.
- Model requests are sent only to the provider selected by the user.

## What Is In Scope

- unauthorized local data exposure
- accidental credential leakage
- Electron context isolation bypass
- plugin sandbox escape
- injection into file import/export
- unsafe network request handling
- destructive state migration

## What Is Out of Scope

- compromised operating system
- compromised browser profile
- user sharing their exported configuration or API key
- malicious model provider responses beyond reasonable handling
- third-party financial data source outages
