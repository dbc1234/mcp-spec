# mcp-spec

[![CI](https://github.com/dbc1234/mcp-spec/actions/workflows/ci.yml/badge.svg)](https://github.com/dbc1234/mcp-spec/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)

**Conformance and behavior testing for MCP servers.** Point it at your server, get a pass/fail report, wire it into CI.

```bash
npx github:dbc1234/mcp-spec -- node dist/index.js
```

```
  my-server v1.2.0 — node dist/index.js

  Conformance  22/26 rules passed  ✖  [recommended]

    ✖ hygiene/stdout-jsonrpc-only
      1 non-JSON-RPC line(s) written to stdout
      → in a stdio server stdout is the wire — clients drop these lines silently,
        so the symptom is a hang or a missing response. Log to stderr instead.

    ✖ tools/required-properties-exist
      `search` requires `limit`, which is not defined in properties
      inputSchema.required
      → the model can never satisfy this schema, so the tool becomes uncallable

    ⚠ tools/param-description
      `search.query` has no description
      → undescribed parameters are the most common cause of malformed tool calls

  Behavior     4/4 tests passed  ✓

  startup 212ms  ·  6 tools  ·  ~1840 tokens of tool definitions

  2 errors, 1 warning
```

## Why this exists

The official [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a debugger: you drive it, you look at the output, you decide whether it's right. That is the wrong shape for CI. `mcp-spec` is the other half — you declare what should be true once, and it fails your build when it stops being true.

It also sees things a normal client cannot:

- **It reads raw responses.** The MCP SDK validates every result against the spec schema and throws on a mismatch. That's correct for an application and useless for a linter — a server whose `tools/list` is malformed is exactly the case worth reporting, and the SDK rejects the payload before you can look at it. `mcp-spec` issues unvalidated requests so it can report what your server actually sent.
- **It catches stdout pollution.** The SDK's read buffer silently discards any stdout line that isn't valid JSON-RPC. A stray `console.log` in a stdio server therefore breaks nothing visibly — it just makes a response vanish, and every client, including the Inspector, shows you nothing. `mcp-spec` ships its own stdio transport that keeps those lines and reports them.

## Install

Not on npm yet — install straight from this repo:

```bash
npm install --save-dev github:dbc1234/mcp-spec
```

The package builds itself on install, so no extra step is needed. Pin a tag if you want reproducible CI: `github:dbc1234/mcp-spec#v0.1.0`.

Node 20 or newer. Works against any MCP server in any language — it talks the protocol, not your runtime.

## Usage

Run against a server without any config:

```bash
npx github:dbc1234/mcp-spec -- python -m my_server        # stdio
npx github:dbc1234/mcp-spec --url https://example.com/mcp # streamable http
```

Once it's a dev dependency, the local binary is just `mcp-spec`:

```bash
npx mcp-spec init   # writes mcp.test.yaml
npx mcp-spec
```

### `mcp.test.yaml`

```yaml
server:
  command: node
  args: [dist/index.js]
  env:
    API_TOKEN: test-token

# strict promotes every warning to an error; off disables the catalog
conformance: recommended

# Fail when tool definitions grow past this token estimate
contextBudget: 4000

rules:
  tools/annotations-present: off   # we ship annotations in the next release

tests:
  - name: search returns a text block
    tool: search
    input: { query: "mcp" }
    expect:
      isError: false
      content.0.type: text
      content.0.text: { contains: "mcp" }

  - name: search rejects an empty query
    tool: search
    input: { query: "" }
    expectError: "must not be empty"

  - name: the changelog resource is readable
    resource: docs://changelog
    expect:
      contents.0.mimeType: text/markdown
```

Relative paths resolve against the config file's directory, not your shell's cwd.

### Expectations

Keys are dotted paths into the result; numeric segments index arrays. A bare value means deep equality, or use an operator:

| Operator | Meaning |
| --- | --- |
| `equals` | deep equality |
| `contains` | substring of the value (JSON-stringified if not a string) |
| `matches` | regular expression |
| `type` | `string` · `number` · `boolean` · `object` · `array` · `null` |
| `exists` | the path is present (or, with `false`, absent) |
| `length` | length of a string, array or object |
| `gt` / `lt` | numeric comparison |

`isError: false` passes when the server omits `isError` entirely, since the spec defines that as the default.

## Rule catalog

`npx mcp-spec rules` prints the current catalog. Severities shown are the `recommended` profile; `strict` promotes everything to `error`.

### protocol

| Rule | Default | Checks |
| --- | --- | --- |
| `protocol/server-info` | warn | `initialize` returns a name and a version |
| `protocol/ping` | warn | the server answers `ping` |
| `protocol/capabilities-declared` | error | every primitive actually served is declared in capabilities |
| `protocol/unknown-method` | warn | an unimplemented method returns `-32601` |
| `protocol/unknown-tool` | error | calling a tool that doesn't exist fails cleanly |
| `protocol/invalid-arguments` | warn | arguments violating the declared schema are rejected |

### tools

| Rule | Default | Checks |
| --- | --- | --- |
| `tools/name-format` | error | names match `^[a-zA-Z0-9_-]{1,64}$` |
| `tools/name-unique` | error | no duplicate tool names |
| `tools/description-present` | error | every tool has a description |
| `tools/description-length` | warn | descriptions stay under 1024 characters |
| `tools/input-schema-valid` | error | `inputSchema` compiles and is an object schema |
| `tools/no-required-false` | error | `required` isn't used as a boolean property flag |
| `tools/required-properties-exist` | error | every required name is defined in `properties` |
| `tools/param-description` | warn | every parameter carries a description |
| `tools/portable-schema` | warn | avoids `$ref`/`oneOf`/`allOf`/… that some clients reject |
| `tools/annotations-present` | warn | `readOnlyHint` / `destructiveHint` are declared |
| `tools/output-schema-valid` | error | `outputSchema`, when present, compiles |
| `tools/context-cost` | warn | the tool list fits `contextBudget` |

### resources · prompts · hygiene

| Rule | Default | Checks |
| --- | --- | --- |
| `resources/uri-valid` | error | resource URIs are absolute |
| `resources/readable` | error | listed resources can actually be read |
| `resources/name-present` | warn | resources have a human-readable name |
| `resources/mime-type` | warn | resources declare a `mimeType` |
| `prompts/name-unique` | error | no duplicate prompt names |
| `prompts/described` | warn | prompts and their arguments are described |
| `hygiene/stdout-jsonrpc-only` | error | nothing but JSON-RPC reaches stdout |
| `hygiene/no-empty-surface` | error | the server exposes something a model can use |
| `hygiene/startup-time` | warn | `initialize` completes inside `startupBudget` |
| `hygiene/stderr-quiet` | warn | no debug spray on a clean run |

Rules that need a capability the server doesn't declare are skipped, not failed.

## CI

### GitHub Actions

```yaml
- uses: actions/setup-node@v5
  with:
    node-version: 20
- run: npm ci && npm run build
- uses: dbc1234/mcp-spec@v0
  with:
    command: node dist/index.js
    conformance: strict
```

Or just call the CLI and let your existing reporter pick it up:

```yaml
- run: npx github:dbc1234/mcp-spec --reporter junit --out mcp-spec.xml
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | no errors, no failing tests |
| `1` | conformance errors or failing tests |
| `2` | could not run — bad config, or the server never completed `initialize` |

Warnings never fail the build. Promote the ones you care about with `rules:` or turn on `conformance: strict`.

## CLI

```
mcp-spec [options]                    run against the nearest mcp.test.yaml
mcp-spec -- <command> [args...]       run against an ad-hoc stdio server
mcp-spec --url <url>                  run against an ad-hoc HTTP server
mcp-spec init                         write a starter mcp.test.yaml
mcp-spec rules                        print the rule catalog

-c, --config <path>     config file to use
-r, --reporter <name>   pretty | json | junit          (default: pretty)
-o, --out <path>        write the report to a file
    --conformance <p>   strict | recommended | off
    --budget <tokens>   fail when tool definitions exceed this token estimate
    --header <k:v>      extra HTTP header, repeatable  (with --url)
    --timeout <ms>      per-request timeout            (default: 30000)
    --no-tests          run conformance only
```

## Programmatic use

```ts
import { run, validateConfig } from "mcp-spec";

const result = await run(
  validateConfig({ server: { command: "node", args: ["dist/index.js"] } }),
);

for (const finding of result.conformance.findings) {
  console.log(finding.severity, finding.rule, finding.message);
}
```

`run()` returns the same object the `json` reporter prints.

## A note on the token estimate

`contextBudget` uses a character-and-word heuristic, not a real BPE tokenizer — every model tokenizes differently, and shipping one would dominate the install size. It runs slightly high, which is the safe direction for a budget. Treat it as a trend line, not an invoice.

## Contributing

Rules live in [`src/rules/`](src/rules/), one file per category. A new rule needs an entry in the catalog and a matching defect in [`test/fixtures/messy-server.mjs`](test/fixtures/messy-server.mjs) — the test suite asserts that every rule actually fires. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
