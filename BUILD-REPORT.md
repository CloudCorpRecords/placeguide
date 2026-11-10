# BUILD REPORT — placeguide

Rebuild of `com.itsnum/places` v1.0.0 (remote-only)
as `@reneturcios/placeguide` 0.1.0 / `io.github.CloudCorpRecords/placeguide`.
**Full surface built: all 9 captured tools (9/9).**

## Fixture conflicts

**None.** The spec, the brief, and the fixture agree on the nine tool
names, their order, and their required fields. Required fields as
served, taken from the fixture
(`harness/fixtures/itsnum-places-tools-original.json`):

- `search_places` — required: `destination`
- `concierge_answer` — required: `question`
- `list_destinations` — NO `required` key in its schema (properties: `{}`)
- `place_details` — required: `place_id`
- `open_places` — required: `destination`
- `booking_link` — required: `place_id`
- `get_menu` — required: `place_id`
- `get_reviews` — required: `place_id`
- `directory_feed` — required: `destination`

The fixture's tool literals (name, title, description, inputSchema —
every captured tool carries a `title` key, and all four keys are
served) are served verbatim from `src/forward.ts`; the literals were
generated programmatically from the fixture JSON (parsed and
re-serialised by `/tmp/b39-placeguide-gen.py`, never retyped) and
verified by the registration-integrity test (served tools/list
deep-equals the fixture's 9 tool objects, in order) and again by the
parity harness.

Judgment calls recorded in the spec, followed here: `place_details`
returns a venue's own published listing data (public business-listing
data, the mapsdata precedent); `booking_link` by its own captured
description does NOT make a reservation — it returns a pre-filled
booking page on the venue's own platform; `get_reviews` returns a
rating summary only, with no review text and no reviewer identities.
No tool reserves, pays, sends, or creates an account, so the surface
is built in full.

## What was built

All 19 factory files under `builds/placeguide/`:

- `package.json` (`@reneturcios/placeguide` 0.1.0, bin
  `placeguide` → `dist/cli.js`, `mcpName`
  `io.github.CloudCorpRecords/placeguide`, deps exactly
  `@modelcontextprotocol/sdk ^1` + `zod ^3`; devDeps
  `@types/node ^20`, `tsx ^4`, `typescript ^5`)
- `server.json` (description exactly the prescribed 80-char string
  "Search verified places, menus, reviews and hours across 119 travel destinations.",
  measured at 80 chars; npm entry carries `"version": "0.1.0"`; OCI
  entry `ghcr.io/cloudcorprecords/placeguide:0.1.0` carries **no**
  version field)
- `Dockerfile` (node:20-alpine both stages; server-name label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/placeguide"`
  matches `server.json`)
- `tsconfig.json` (fleet-identical, 318 bytes), `.gitignore`,
  `package-lock.json`, `README.md` (fresh prose), `LICENSE` (MIT,
  Copyright (c) 2026 Rene Turcios), `CHANGELOG.md` (single 0.1.0
  entry, 2026-10-28)
- `src/index.ts`, `src/cli.ts`, `src/mcp.ts`, `src/types.ts`,
  `src/forward.ts` (core; exports `VERSION = "0.1.0"`)
- `test/forward.test.ts`
- `.github/workflows/{ci.yml, publish.yml, publish-container.yml,
  registry-publish.yml}` (container workflow: IMAGE
  `ghcr.io/cloudcorprecords/placeguide`, smoke assertion on server
  name `placeguide`)

Plus `BUILD-REPORT.md` (this file) and the `parity-out/` harness
output.

## Design

- Forwarding client to `https://app.itsnum.com/api/partner/mcp`
  (pinned), overridable via `ITSNUM_MCP_URL` (LABELLED
  RECONSTRUCTION). tools/call is forwarded as a streamable-HTTP
  JSON-RPC client: initialize (protocolVersion `2025-03-26`,
  clientInfo `placeguide`) → notifications/initialized → tools/call,
  honouring `Mcp-Session-Id` when issued; session established lazily
  and reused per client. Plain-JSON and SSE replies both parsed; the
  matching-id message wins; upstream results pass through verbatim
  (including `isError` and extra fields such as
  `structuredContent`).
- When `ITSNUM_PARTNER_KEY` is set, an `X-Partner-Key: <value>`
  header is sent on every upstream request (header name pinned by
  the registry record's own remote declaration, which declares a
  secret `X-Partner-Key` header not marked required; the env name
  and the env forwarding are LABELLED RECONSTRUCTIONS — the record
  pins no package env name and the capture was keyless). When unset
  (or blank), no key header is sent. No `Authorization` header is
  sent in either case. Both branches are covered by tests.
- Upstream failures (JSON-RPC error, non-2xx status, malformed body,
  throwing/timing-out fetch) surface as `placeguide error:` text
  results (LABELLED RECONSTRUCTION).
- Registration via the MCP SDK **low-level** `Server` API
  (`ListToolsRequestSchema` / `CallToolRequestSchema` handlers)
  serving the fixture literals exactly; no `McpServer` + zod
  registration (per the task brief, overriding TEMPLATE.md §2
  item 12). `src/mcp.ts` also exports `createServer` /
  `startMcpServer` / `handleCallTool` so the MCP layer is testable
  without a transport; the CLI's `mcp` subcommand starts it over
  stdio.
- Core takes an injectable fetch (`ForwardDeps.fetchFn`), so all
  tests run against a stubbed JSON-RPC upstream. No live network
  calls in tests; no live call claimed beyond the coordinator's
  tools/list captures.

## Labelled reconstructions (from the spec's Wire section)

- `ITSNUM_MCP_URL` env override of the pinned endpoint
  `https://app.itsnum.com/api/partner/mcp`.
- `ITSNUM_PARTNER_KEY` env name and the forwarding of its value as
  `X-Partner-Key: <value>` (header name pinned by the registry
  record; env name pinned by nothing, capture keyless).
- The `placeguide error:` failure rendering for upstream failures.

## Lockfile (Route 3, clean from birth)

Generated in the build dir with no `node_modules` present and no
pre-existing lockfile:
`npm install --package-lock-only --ignore-scripts --offline`.
Verified: parses, `name == @reneturcios/placeguide`,
**128 package entries**, sha256
`f8819661a9c01858124108a51654beac9c02c9ae25336f664e5706b6c5dd7153`
(re-verified unchanged after the subsequent `npm install`).
Then `npm install --offline --ignore-scripts` in the build dir for
`node_modules`.

## Verification (all in the build dir unless noted)

- `npx tsc --noEmit` → exit 0
- `npm run build` → real `dist/` (cli.js, forward.js, mcp.js, all
  non-empty, with `.d.ts` + source maps)
- `node dist/cli.js --version` → `0.1.0`; unknown subcommand → usage
  on stderr, exit 2
- `npm test` → **65 tests, 65 pass, 0 fail** (8 suites: registration
  integrity — served tools deep-equal the fixture's full 9 tool
  objects, names in order, exactly the fixture's keys per tool with
  titles, titles verbatim, required fields per tool,
  list_destinations carrying no `required` key, every property key
  in order for all 9 tools, property-type literals, attribution /
  no-reservation / summary-only description wording, isKnownTool;
  session establishment/reuse/session-id handling, clientInfo /
  protocol version; env URL override, explicit url override,
  explicit-over-env precedence, blank-env fallback; X-Partner-Key
  present on every request when the key is set / absent when unset /
  blank treated as unset / no Authorization header in either case;
  verbatim argument forwarding for all 9 tools plus fully-specified
  search_places, booking_link and directory_feed cursor calls;
  verbatim result pass-through incl. upstream isError and SSE;
  JSON-RPC / init / malformed / no-result / HTTP / throw / timeout
  failures → `placeguide error:`; parseRpcBody JSON + SSE +
  matching-id + [DONE] cases; MCP-layer MethodNotFound /
  InvalidParams validation; CLI --version / -v / unknown exit 2 /
  bad-JSON exit 2 / `mcp extra` exit 2)
- Parity: `python3 harness/parity.py --original
  harness/fixtures/itsnum-places-tools-original.json --rebuild
  "stdio:node builds/placeguide/dist/cli.js mcp" --out
  builds/placeguide/parity-out` (run from
  `~/workspace/mcp-rebuild-100`) → **PASS, parity 100.0, 9/9
  identical, no missing/extra/schema diffs** (see
  `parity-out/parity.json`)
- Consistency sweep: package.json version = server.json top-level =
  npm-entry version = OCI tag = core `VERSION` = CHANGELOG heading
  (0.1.0); package.json `mcpName` = server.json `name` = Dockerfile
  label; server.json description measured at 80 chars; OCI entry
  confirmed to have no `version` field.

Clean-room: all prose and code written fresh for placeguide; only
the mechanics were patterned on the sibling imgpage build (same
forwarding-client class), and only the fixture's tool literals are
served verbatim.
