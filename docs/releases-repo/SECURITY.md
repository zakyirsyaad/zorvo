# Security policy

## Reporting a problem

Please report a security problem privately: open this repository's
[Security tab](https://github.com/zakyirsyaad/zorvo-releases/security) and
choose **Report a vulnerability**. Only the maintainer can read the report.
Do not open a public issue for it.

Tell us:

- the Zorvo version (shown at the bottom of the sidebar) and your macOS version;
- what an attacker could do, and what they need for it;
- the steps to reproduce it.

You will get a reply as soon as possible. Once a fix ships, the release notes say
so, and you are credited unless you ask not to be.

## Supported versions

Only the latest release gets security fixes. Update to it before reporting.

## What is in scope

- The Zorvo app: its backend, its window, and how it starts, stops and talks
  to agents.
- Agent installs: Zorvo checks every download against a pinned SHA-256 hash.
- Anything that lets a folder, an agent or a web page reach files, commands or
  data that Zorvo should not give it.

The agents themselves (Claude Code, Codex, Qwen Code, Gemini CLI and others)
are separate products: report their problems to their makers.

## Check what you downloaded

Download Zorvo only from this repository's
[releases](https://github.com/zakyirsyaad/zorvo-releases/releases), and check
the file against the release's `SHA256SUMS.txt` (see
[Check your download](README.md#check-your-download)).
