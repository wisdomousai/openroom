# Contributing

Issues and pull requests are welcome.

## Before you open a pull request

- Read [`AGENTS.md`](AGENTS.md). It holds the repository rules for architecture,
  CRUD routes, naming, the surfaces agents use, and testing. They apply to human
  contributors too.
- Run `bun run verify` and fix anything it reports. It builds every package and
  app, typechecks them and runs the unit tests. If your change touches a user
  journey, also run `bun run verify:browser`.
- Keep a pull request to one change, and say in the description what it changes
  and why.

## Contributor License Agreement

Every contributor signs the [Contributor License Agreement](CLA.md) once, through
the CLA check that appears on their first pull request. A pull request cannot be
merged until it is signed.

OpenRoom's core is released under the MIT licence and its workspace under the
AGPL ([`LICENSING.md`](LICENSING.md) maps each directory). OpenRoom is also offered
under a commercial licence. The CLA covers contributions to either half and gives
the maintainer the right to include your contribution in the open-source and the
commercial releases. You keep the copyright to your work.

## Security

Report vulnerabilities privately through GitHub's **Report a vulnerability**
button on the Security tab, not in a public issue.
