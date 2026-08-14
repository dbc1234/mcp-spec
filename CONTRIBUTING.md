# Contributing

```bash
npm install
npm run build
npm test
npm run selftest   # runs the CLI against examples/demo-server.mjs
```

## Adding a rule

Rules live in `src/rules/`, one file per category (`protocol`, `tools`, `resources`, `prompts`, `hygiene`). A rule is a plain object:

```ts
{
  name: "tools/my-check",       // must be `<category>/<slug>`
  category: "tools",
  description: "one line, shown by `mcp-spec rules`",
  defaultSeverity: "warn",       // severity under the `recommended` profile
  requires: "tools",             // skip when the capability is absent
  run(ctx) {
    return { findings: [ /* ... */ ] };
  },
}
```

Four things to know:

1. **Rules never connect to anything.** The runner hands you an initialized server in `ctx`, along with the full tool/resource/prompt lists, the captured stderr, and the stdout lines that weren't JSON-RPC. If you need something that isn't on `RuleContext`, add it there rather than opening your own connection.
2. **Every finding needs a `hint`** that says what breaks in practice. `"missing description"` is not useful on its own; `"the description is the only thing telling the model when to pick this tool"` is.
3. **Add the defect to `test/fixtures/messy-server.mjs`** and list the rule in the `EXPECTED` array in `test/catalog.test.ts`. The suite asserts that every rule actually fires, so a rule with no fixture is a rule nobody knows is broken.
4. **Keep `examples/demo-server.mjs` clean.** CI runs the demo under `--conformance strict`; if your new rule fires on a correct server, it's a false positive and the build says so.

Then add a row to the catalog table in the README.

## Severity

Use `error` when the defect makes the server wrong or unusable — a schema that can't be satisfied, a tool that can't be called. Use `warn` for things that degrade quality but leave the server working: a missing description, an unportable schema keyword, a slow start.

`strict` promotes every warning to an error, so a rule set to `warn` still fails builds for projects that ask for it. Reach for `error` only when you're confident it's never a style question.

## Why raw requests

`src/raw.ts` sends every request with a pass-through schema instead of using the typed client methods. This is deliberate: the SDK validates results and throws on a mismatch, which would hide the exact malformed payloads the catalog exists to report. Don't "clean this up" by switching to `client.listTools()`.

The same reasoning produced `src/transport/observed-stdio.ts` — the SDK's read buffer discards non-JSON stdout lines silently, so we keep our own.
