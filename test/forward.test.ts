import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import {
  PlaceguideClient,
  callTool,
  createClient,
  DEFAULT_ENDPOINT_URL,
  isKnownTool,
  parseRpcBody,
  PROTOCOL_VERSION,
  TOOL_DEFS,
  TOOL_NAMES,
  VERSION,
} from "../src/forward.js";
import { handleCallTool } from "../src/mcp.js";
import type {
  FetchFn,
  FetchResponseLike,
  ToolDef,
  ToolResult,
} from "../src/types.js";

/**
 * Every test runs against a stubbed JSON-RPC upstream
 * that speaks the streamable-HTTP session flow
 * (initialize -> notifications/initialized ->
 * tools/call). No live network: the real itsnum
 * endpoint is never contacted.
 */

const FIXTURE_URL = new URL(
  "../../../harness/fixtures/itsnum-places-tools-original.json",
  import.meta.url,
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_URL);
const fixture = (
  FIXTURE_AVAILABLE
    ? JSON.parse(readFileSync(FIXTURE_URL, "utf-8"))
    : { tools: [] }
) as {
  tools: ToolDef[];
};
/**
 * Publish-survival guard (Wave 25 preflight, proven Wave 24 pattern):
 * the parity fixture lives in the build harness, outside the published
 * repo tree, so fixture-dependent tests skip cleanly when it is absent;
 * with the fixture present they run in full, with no skips.
 */
function skipWithoutFixture(t: {
  skip: (message: string) => void;
}): boolean {
  if (FIXTURE_AVAILABLE) return false;
  t.skip("parity fixture lives in the build harness, not the repo tree");
  return true;
}


const EXPECTED_NAMES = [
  "search_places",
  "concierge_answer",
  "list_destinations",
  "place_details",
  "open_places",
  "booking_link",
  "get_menu",
  "get_reviews",
  "directory_feed",
];

const SAMPLE_RESULT = {
  content: [
    {
      type: "text",
      text: "{\"places\":[{\"name\":\"Kata Seafood\"}],\"attribution\":\"Data: Num\"}",
    },
  ],
  structuredContent: { places: [{ name: "Kata Seafood" }] },
};

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

interface FakeOptions {
  callResult?: Record<string, unknown>;
  callBodyText?: string;
  callError?: Record<string, unknown>;
  callStatus?: number;
  initError?: Record<string, unknown>;
  throwOn?: "initialize" | "tools/call";
  sessionId?: string | null;
  hangOnCall?: boolean;
  sse?: boolean;
}

function makeResponse(
  status: number,
  bodyText: string,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const lowered = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lowered.get(name.toLowerCase()) ?? null },
    text: async () => bodyText,
  };
}

function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return makeResponse(status, JSON.stringify(payload), headers);
}

function makeUpstream(options: FakeOptions = {}): {
  fetchFn: FetchFn;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchFn: FetchFn = async (url, init) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init?.headers ?? {}, body });
    const method = body.method as string;
    if (options.throwOn === method) throw new Error("connection reset");
    if (method === "initialize") {
      if (options.initError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.initError,
        });
      }
      const headers: Record<string, string> = {};
      const sessionId =
        options.sessionId === undefined ? "sess-places-1" : options.sessionId;
      if (sessionId !== null) headers["mcp-session-id"] = sessionId;
      return jsonResponse(
        200,
        {
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            serverInfo: { name: "places", version: "1.0.0" },
          },
        },
        headers,
      );
    }
    if (method === "notifications/initialized") {
      return makeResponse(202, "");
    }
    if (method === "tools/call") {
      if (options.hangOnCall) {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            if (signal.aborted) {
              reject(new Error("aborted"));
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")));
          }
        });
      }
      if (options.callBodyText !== undefined) {
        return makeResponse(options.callStatus ?? 200, options.callBodyText);
      }
      if (options.callError !== undefined) {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          error: options.callError,
        });
      }
      const result = options.callResult ?? SAMPLE_RESULT;
      const payload = { jsonrpc: "2.0", id: body.id, result };
      if (options.sse) {
        return makeResponse(
          200,
          `event: message\ndata: ${JSON.stringify(payload)}\n\n`,
        );
      }
      return jsonResponse(options.callStatus ?? 200, payload);
    }
    return jsonResponse(200, {});
  };
  return { fetchFn, calls };
}

function stubClient(options: FakeOptions = {}, extra: Record<string, unknown> = {}) {
  const upstream = makeUpstream(options);
  const c = new PlaceguideClient({
    fetchFn: upstream.fetchFn,
    env: {},
    ...extra,
  });
  return { client: c, calls: upstream.calls };
}

function textOf(result: ToolResult): string {
  const content = result.content as Array<{ type: string; text: string }>;
  return content[0].text;
}

function methods(calls: Captured[]): string[] {
  return calls.map((c) => c.body.method as string);
}

function propsOf(tool: ToolDef): Record<string, Record<string, unknown>> {
  return (
    tool.inputSchema as {
      properties: Record<string, Record<string, unknown>>;
    }
  ).properties;
}

/* ------------------------------------------------------------------ */

describe("registration integrity (captured surface)", () => {
  it("serves exactly the fixture's 9 tools, deep-equal", (t) => {
    if (skipWithoutFixture(t)) return;
    assert.equal(fixture.tools.length, 9);
    assert.deepEqual(TOOL_DEFS, fixture.tools);
  });

  it("serves the 9 tool names in fixture order", () => {
    assert.deepEqual(TOOL_NAMES, EXPECTED_NAMES);
  });

  it("carries exactly the fixture's keys on each tool, title included", () => {
    for (const tool of TOOL_DEFS) {
      assert.deepEqual(Object.keys(tool).sort(), [
        "description",
        "inputSchema",
        "name",
        "title",
      ]);
    }
  });

  it("carries the fixture's titles verbatim", () => {
    assert.deepEqual(
      TOOL_DEFS.map((t) => t.title),
      [
        "Search real places in a destination",
        "Ask Num a travel question",
        "List the destinations Num covers",
        "Get one place in full",
        "Find places open at a time",
        "How to book a place",
        "Read a place’s menu",
        "Read reviews of a place",
        "Page through the directory",
      ],
    );
  });

  it("carries exactly the fixture's required fields per tool", () => {
    const required = TOOL_DEFS.map(
      (t) => (t.inputSchema as { required?: string[] }).required ?? null,
    );
    assert.deepEqual(required, [
      ["destination"],
      ["question"],
      null,
      ["place_id"],
      ["destination"],
      ["place_id"],
      ["place_id"],
      ["place_id"],
      ["destination"],
    ]);
  });

  it("list_destinations has no required key and no properties", () => {
    const schema = TOOL_DEFS[2].inputSchema as Record<string, unknown>;
    assert.equal("required" in schema, false);
    assert.deepEqual(schema.properties, {});
  });

  it("carries every fixture property, in order, for all 9 tools", (t) => {
    if (skipWithoutFixture(t)) return;
    for (let i = 0; i < 9; i += 1) {
      assert.deepEqual(
        Object.keys(propsOf(TOOL_DEFS[i])),
        Object.keys(propsOf(fixture.tools[i])),
      );
    }
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[0])), [
      "destination",
      "category",
      "near",
      "query",
      "limit",
    ]);
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[1])), [
      "question",
      "destination",
      "near",
      "language",
    ]);
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[4])), [
      "destination",
      "category",
      "near",
      "bookable_only",
      "limit",
    ]);
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[5])), [
      "place_id",
      "party",
      "date",
      "time",
    ]);
    assert.deepEqual(Object.keys(propsOf(TOOL_DEFS[8])), [
      "destination",
      "cursor",
      "limit",
    ]);
  });

  it("carries the fixture's property types verbatim", () => {
    const search = propsOf(TOOL_DEFS[0]);
    assert.equal(search.destination.type, "string");
    assert.equal(search.category.type, "string");
    assert.equal(search.near.type, "string");
    assert.equal(search.query.type, "string");
    assert.equal(search.limit.type, "integer");
    const concierge = propsOf(TOOL_DEFS[1]);
    assert.equal(concierge.question.type, "string");
    assert.equal(concierge.language.type, "string");
    const open = propsOf(TOOL_DEFS[4]);
    assert.equal(open.bookable_only.type, "boolean");
    assert.equal(open.limit.type, "integer");
    const booking = propsOf(TOOL_DEFS[5]);
    assert.equal(booking.party.type, "integer");
    assert.equal(booking.date.type, "string");
    assert.equal(booking.time.type, "string");
    for (const idx of [3, 6, 7]) {
      assert.equal(propsOf(TOOL_DEFS[idx]).place_id.type, "string");
    }
    const feed = propsOf(TOOL_DEFS[8]);
    assert.equal(feed.cursor.type, "string");
    assert.equal(feed.limit.type, "integer");
  });

  it("keeps the captured attribution duty in the search description", () => {
    assert.match(TOOL_DEFS[0].description, /You MUST display the returned `attribution`/);
    assert.match(TOOL_DEFS[6].description, /You MUST display the returned `attribution`/);
  });

  it("keeps the captured no-reservation wording in booking_link", () => {
    assert.match(TOOL_DEFS[5].description, /does NOT make a reservation/);
    assert.match(TOOL_DEFS[5].description, /booked: false/);
  });

  it("keeps the captured summary-only wording in get_reviews", () => {
    assert.match(TOOL_DEFS[7].description, /no review text and no reviewer identities, ever/);
  });

  it("isKnownTool recognises the 9 built tools and rejects others", () => {
    for (const name of EXPECTED_NAMES) assert.equal(isKnownTool(name), true);
    assert.equal(isKnownTool("search"), false);
    assert.equal(isKnownTool("book_place"), false);
    assert.equal(isKnownTool(""), false);
  });
});

/* ------------------------------------------------------------------ */

describe("session establishment and reuse", () => {
  it("runs initialize, notifications/initialized, then tools/call in order", async () => {
    const { client: c, calls } = stubClient();
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
    assert.ok(calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
    assert.equal(DEFAULT_ENDPOINT_URL, "https://app.itsnum.com/api/partner/mcp");
    for (const call of calls) {
      assert.equal(call.headers["Content-Type"], "application/json");
      assert.equal(call.headers["Accept"], "application/json, text/event-stream");
    }
    assert.equal(calls[0].headers["Mcp-Session-Id"], undefined);
    assert.equal(calls[1].headers["Mcp-Session-Id"], "sess-places-1");
    assert.equal(calls[2].headers["Mcp-Session-Id"], "sess-places-1");
  });

  it("sends clientInfo name placeguide and the pinned protocol version on initialize", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("list_destinations", {});
    const initParams = calls[0].body.params as Record<string, unknown>;
    assert.equal(initParams.protocolVersion, PROTOCOL_VERSION);
    assert.equal(PROTOCOL_VERSION, "2025-03-26");
    assert.deepEqual(initParams.capabilities, {});
    assert.deepEqual(initParams.clientInfo, { name: "placeguide", version: VERSION });
  });

  it("establishes the session lazily once and reuses it on later calls", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("search_places", { destination: "phuket" });
    await c.callTool("get_menu", { place_id: "p-1" });
    assert.deepEqual(methods(calls), [
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    assert.equal(calls[3].headers["Mcp-Session-Id"], "sess-places-1");
    assert.notEqual(calls[2].body.id, calls[3].body.id);
  });

  it("sends no session header when the upstream issues none", async () => {
    const { client: c, calls } = stubClient({ sessionId: null });
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.equal(out.isError, undefined);
    assert.ok(calls.every((call) => call.headers["Mcp-Session-Id"] === undefined));
  });

  it("honours the ITSNUM_MCP_URL env override", async () => {
    const upstream = makeUpstream();
    const c = new PlaceguideClient({
      fetchFn: upstream.fetchFn,
      env: { ITSNUM_MCP_URL: "https://staging.example.com/mcp" },
    });
    await c.callTool("search_places", { destination: "phuket" });
    assert.ok(
      upstream.calls.every((call) => call.url === "https://staging.example.com/mcp"),
    );
  });

  it("honours an explicit url override over the default endpoint", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: {},
      url: "https://alt.example.com/mcp",
    });
    await c.callTool("list_destinations", {});
    assert.ok(upstream.calls.every((call) => call.url === "https://alt.example.com/mcp"));
  });

  it("prefers an explicit url override over the env override", async () => {
    const upstream = makeUpstream();
    const c = createClient({
      fetchFn: upstream.fetchFn,
      env: { ITSNUM_MCP_URL: "https://env.example.com/mcp" },
      url: "https://explicit.example.com/mcp",
    });
    await c.callTool("search_places", { destination: "phuket" });
    assert.ok(
      upstream.calls.every((call) => call.url === "https://explicit.example.com/mcp"),
    );
  });

  it("falls back to the pinned endpoint when the env override is blank", async () => {
    const upstream = makeUpstream();
    const c = new PlaceguideClient({
      fetchFn: upstream.fetchFn,
      env: { ITSNUM_MCP_URL: "   " },
    });
    await c.callTool("search_places", { destination: "phuket" });
    assert.ok(upstream.calls.every((call) => call.url === DEFAULT_ENDPOINT_URL));
  });
});

/* ------------------------------------------------------------------ */

describe("partner key header", () => {
  it("sends X-Partner-Key on every request when ITSNUM_PARTNER_KEY is set", async () => {
    const upstream = makeUpstream();
    const c = new PlaceguideClient({
      fetchFn: upstream.fetchFn,
      env: { ITSNUM_PARTNER_KEY: "partner-key-7" },
    });
    await c.callTool("search_places", { destination: "phuket" });
    assert.equal(upstream.calls.length, 3);
    assert.ok(
      upstream.calls.every(
        (call) => call.headers["X-Partner-Key"] === "partner-key-7",
      ),
    );
  });

  it("sends no X-Partner-Key header when ITSNUM_PARTNER_KEY is unset", async () => {
    const { client: c, calls } = stubClient();
    await c.callTool("search_places", { destination: "phuket" });
    assert.ok(calls.every((call) => call.headers["X-Partner-Key"] === undefined));
  });

  it("treats a blank ITSNUM_PARTNER_KEY as unset", async () => {
    const upstream = makeUpstream();
    const c = new PlaceguideClient({
      fetchFn: upstream.fetchFn,
      env: { ITSNUM_PARTNER_KEY: "   " },
    });
    await c.callTool("search_places", { destination: "phuket" });
    assert.ok(
      upstream.calls.every((call) => call.headers["X-Partner-Key"] === undefined),
    );
  });

  it("never sends an Authorization header, with or without a key", async () => {
    const withKey = makeUpstream();
    const c1 = new PlaceguideClient({
      fetchFn: withKey.fetchFn,
      env: { ITSNUM_PARTNER_KEY: "partner-key-7" },
    });
    await c1.callTool("search_places", { destination: "phuket" });
    assert.ok(withKey.calls.every((call) => call.headers["Authorization"] === undefined));
    const { client: c2, calls } = stubClient();
    await c2.callTool("search_places", { destination: "phuket" });
    assert.ok(calls.every((call) => call.headers["Authorization"] === undefined));
  });
});

/* ------------------------------------------------------------------ */

describe("tools/call forwarding", () => {
  const forwardCases: Array<[string, Record<string, unknown>]> = [
    ["search_places", { destination: "phuket" }],
    ["concierge_answer", { question: "where should we eat tonight near Kata?" }],
    ["list_destinations", {}],
    ["place_details", { place_id: "p-1" }],
    ["open_places", { destination: "los-angeles" }],
    ["booking_link", { place_id: "p-1" }],
    ["get_menu", { place_id: "p-1" }],
    ["get_reviews", { place_id: "p-1" }],
    ["directory_feed", { destination: "los-angeles" }],
  ];
  for (const [name, args] of forwardCases) {
    it(`forwards a ${name} call verbatim`, async () => {
      const { client: c, calls } = stubClient();
      const out = await c.callTool(name, args);
      assert.equal(out.isError, undefined);
      const params = calls[2].body.params as Record<string, unknown>;
      assert.equal(params.name, name);
      assert.deepEqual(params.arguments, args);
    });
  }

  it("forwards a fully-specified search_places call verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = {
      destination: "phuket",
      category: "restaurant",
      near: "7.8208,98.2976",
      query: "thai seafood",
      limit: 5,
    };
    await c.callTool("search_places", args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "search_places");
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a fully-specified booking_link call verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { place_id: "p-9", party: 4, date: "2026-11-02", time: "19:30" };
    await c.callTool("booking_link", args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "booking_link");
    assert.deepEqual(params.arguments, args);
  });

  it("forwards a directory_feed cursor page verbatim", async () => {
    const { client: c, calls } = stubClient();
    const args = { destination: "bangkok", cursor: "cur-200", limit: 200 };
    await c.callTool("directory_feed", args);
    const params = calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "directory_feed");
    assert.deepEqual(params.arguments, args);
  });

  it("passes the upstream result through verbatim, including extra fields", async () => {
    const { client: c } = stubClient();
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("passes an upstream isError result through untouched", async () => {
    const upstreamResult = {
      content: [{ type: "text", text: "no coverage there" }],
      isError: true,
    };
    const { client: c } = stubClient({ callResult: upstreamResult });
    const out = await c.callTool("concierge_answer", { question: "dinner in Atlantis?" });
    assert.deepEqual(out, upstreamResult);
  });

  it("reads an SSE-framed tools/call response", async () => {
    const { client: c } = stubClient({ sse: true });
    const out = await c.callTool("get_reviews", { place_id: "p-1" });
    assert.equal(out.isError, undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
  });

  it("the one-shot callTool helper forwards under the right tool name", async () => {
    const upstream = makeUpstream();
    const out = await callTool(
      "place_details",
      { place_id: "p-3" },
      { fetchFn: upstream.fetchFn, env: {} },
    );
    assert.equal(out.isError, undefined);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "place_details");
    assert.deepEqual(params.arguments, { place_id: "p-3" });
  });
});

/* ------------------------------------------------------------------ */

describe("upstream failures surface as placeguide error text", () => {
  it("maps a JSON-RPC error to `placeguide error: <message>`", async () => {
    const { client: c } = stubClient({
      callError: { code: -32000, message: "destination not covered" },
    });
    const out = await c.callTool("search_places", { destination: "atlantis" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "placeguide error: destination not covered");
  });

  it("maps an initialize JSON-RPC error to placeguide error text", async () => {
    const { client: c } = stubClient({
      initError: { code: -32600, message: "bad initialize" },
    });
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "placeguide error: bad initialize");
  });

  it("maps an unparseable upstream response to a malformed-response error", async () => {
    const { client: c } = stubClient({ callBodyText: "<html>oops</html>" });
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "placeguide error: malformed response");
  });

  it("maps a response with no result object to a malformed-response error", async () => {
    const { client: c } = stubClient({
      callBodyText: '{"jsonrpc":"2.0","id":3,"result":null}',
    });
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "placeguide error: malformed response");
  });

  it("maps a non-2xx upstream status to placeguide error text", async () => {
    const { client: c } = stubClient({ callBodyText: "internal error", callStatus: 500 });
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "placeguide error: HTTP 500");
  });

  it("maps a throwing fetch to placeguide error text", async () => {
    const { client: c } = stubClient({ throwOn: "tools/call" });
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^placeguide error: /);
  });

  it("maps a throwing initialize fetch to placeguide error text", async () => {
    const { client: c } = stubClient({ throwOn: "initialize" });
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.equal(out.isError, true);
    assert.equal(textOf(out), "placeguide error: connection reset");
  });

  it("maps a timed-out call to placeguide error text", async () => {
    const { client: c } = stubClient({ hangOnCall: true }, { timeoutMs: 20 });
    const out = await c.callTool("search_places", { destination: "phuket" });
    assert.equal(out.isError, true);
    assert.match(textOf(out), /^placeguide error: /);
  });
});

/* ------------------------------------------------------------------ */

describe("parseRpcBody", () => {
  it("parses plain JSON and picks the message with the matching id", () => {
    const body = '{"jsonrpc":"2.0","id":7,"result":{"ok":true}}';
    assert.deepEqual(parseRpcBody(body, 7), {
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });

  it("parses SSE data lines", () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { ok: true },
    });
  });

  it("picks the matching id among several SSE messages", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":1,"result":{"n":1}}\n\n' +
      'data: {"jsonrpc":"2.0","id":2,"result":{"n":2}}\n\n';
    assert.deepEqual(parseRpcBody(body, 2), {
      jsonrpc: "2.0",
      id: 2,
      result: { n: 2 },
    });
  });

  it("ignores the SSE [DONE] sentinel", () => {
    const body =
      'data: {"jsonrpc":"2.0","id":4,"result":{"ok":true}}\ndata: [DONE]\n';
    assert.deepEqual(parseRpcBody(body, 4), {
      jsonrpc: "2.0",
      id: 4,
      result: { ok: true },
    });
  });

  it("returns null for empty and unparseable bodies", () => {
    assert.equal(parseRpcBody(""), null);
    assert.equal(parseRpcBody("not json at all"), null);
    assert.equal(parseRpcBody("[1,2,3]"), null);
  });
});

/* ------------------------------------------------------------------ */

describe("MCP layer validation", () => {
  it("rejects an unknown tool with MethodNotFound before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "not_a_tool", {}),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.MethodNotFound,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects array arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "search_places", ["nope"]),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("rejects string arguments with InvalidParams before any network hop", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    await assert.rejects(
      () => handleCallTool(c, "get_menu", "place_id=p-1"),
      (err: unknown) =>
        err instanceof McpError && err.code === ErrorCode.InvalidParams,
    );
    assert.equal(upstream.calls.length, 0);
  });

  it("forwards a valid search_places call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, "search_places", { destination: "phuket" });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, { destination: "phuket" });
  });

  it("forwards a valid directory_feed call through the MCP layer unchanged", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, "directory_feed", { destination: "bangkok" });
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.equal(params.name, "directory_feed");
  });

  it("treats omitted arguments as an empty object", async () => {
    const upstream = makeUpstream();
    const c = createClient({ fetchFn: upstream.fetchFn, env: {} });
    const out = await handleCallTool(c, "list_destinations", undefined);
    assert.deepEqual(out, SAMPLE_RESULT);
    const params = upstream.calls[2].body.params as Record<string, unknown>;
    assert.deepEqual(params.arguments, {});
  });
});

/* ------------------------------------------------------------------ */

describe("CLI", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

  function runCli(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", cliPath, ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  }

  it("--version prints 0.1.0 and exits 0", () => {
    const res = runCli(["--version"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
    assert.equal(res.stdout.trim(), VERSION);
  });

  it("-v prints 0.1.0 and exits 0", () => {
    const res = runCli(["-v"]);
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0.1.0");
  });

  it("an unknown command prints usage on stderr and exits 2", () => {
    const res = runCli(["not-a-tool"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /Usage:/);
  });

  it("a non-JSON argument exits 2", () => {
    const res = runCli(["search_places", "not json"]);
    assert.equal(res.status, 2);
  });

  it("a JSON array argument exits 2", () => {
    const res = runCli(["search_places", "[]"]);
    assert.equal(res.status, 2);
  });

  it("extra arguments after mcp exit 2", () => {
    const res = runCli(["mcp", "extra"]);
    assert.equal(res.status, 2);
  });
});
