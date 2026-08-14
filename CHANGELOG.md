# Changelog

## 0.1.0

First release.

- Conformance catalog of 28 rules across protocol, tools, resources, prompts and hygiene, with `strict` / `recommended` / `off` profiles and per-rule severity overrides.
- Declarative behavior tests in `mcp.test.yaml`, with path-based expectations and `contains` / `matches` / `type` / `length` / `gt` / `lt` operators.
- stdio and streamable HTTP transports.
- `pretty`, `json` and `junit` reporters; CI-friendly exit codes.
- Reads raw protocol responses rather than SDK-validated ones, so malformed payloads are reported instead of crashing the run.
- Ships its own stdio transport that surfaces non-JSON-RPC stdout writes, which the SDK's read buffer discards silently.

Distributed from git (`npm install github:dbc1234/mcp-spec`); the `prepare`
script builds the package on install, so no published artifact is required.
