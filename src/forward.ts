/**
 * placeguide core: a forwarding client for the hosted
 * itsnum places MCP server.
 *
 * The directory itself lives upstream. This module
 * keeps the captured tool surface as literal data and
 * answers tools/list from it, and it relays each
 * tools/call to the remote endpoint over the
 * streamable-HTTP flavour of JSON-RPC: first an
 * initialize request (protocolVersion 2025-03-26),
 * then the notifications/initialized notification,
 * then the call itself. If the initialize response
 * carries an Mcp-Session-Id header, that identifier is
 * attached to every later request of the session. The
 * session is opened on first use and kept for the
 * lifetime of the client instance.
 *
 * The endpoint is pinned to
 * https://app.itsnum.com/api/partner/mcp. The
 * ITSNUM_MCP_URL environment variable may replace it;
 * that override is a labelled reconstruction. When
 * ITSNUM_PARTNER_KEY is set, each upstream request
 * carries an `X-Partner-Key: <value>` header (the
 * header name is pinned by the registry record's own
 * remote declaration; the env name and the forwarding
 * from it are labelled reconstructions, because the
 * record pins no package env name and the surface was
 * captured keyless). With the variable unset, no key
 * header is sent at all.
 *
 * Whatever the upstream returns as a result is handed
 * back exactly as it arrived, isError flag and any
 * extra fields included. Anything that goes wrong on
 * the way — a JSON-RPC error object, a non-2xx status,
 * an unparseable body, a fetch that throws or runs
 * past its timeout — is reported as an isError result
 * whose text starts with `placeguide error:` (that
 * rendering is a labelled reconstruction). Response
 * bodies may be plain JSON or SSE `data:` lines; when
 * several messages arrive, the one whose id matches
 * the request is the one that counts.
 */
import type {
  FetchFn,
  FetchResponseLike,
  ForwardDeps,
  ToolArgs,
  ToolDef,
  ToolResult,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_ENDPOINT_URL = "https://app.itsnum.com/api/partner/mcp";

export const DEFAULT_TIMEOUT_MS = 30000;

export const PROTOCOL_VERSION = "2025-03-26";

/* ------------------------------------------------------------------ */
/* Tool definitions (tools/list literals, verbatim from the live       */
/* capture in harness/fixtures/itsnum-places-tools-original.json;      */
/* generated programmatically by parsing and re-serialising the        */
/* fixture JSON, never retyped)                                        */
/* ------------------------------------------------------------------ */

export const TOOL_DEFS: ToolDef[] = [
  {
    "name": "search_places",
    "title": "Search real places in a destination",
    "description": "Find real, currently-operating places in a destination — restaurants, bars, beaches, spas, viewpoints, temples. Ranked by quality (rating weighted by how many reviews stand behind it). When `near` is a \"lat,lng\" coordinate pair, results are limited to about 5 km of that point, ranked by a blend of quality and distance — so a 4.8★ institution two streets away beats an unrated snack bar next door — and each carries `distance_m`. When `near` is a neighbourhood name it filters by area and NO distance is returned. Returns name, category, area, rating, review count, phone, address and opening hours where known. NEVER invents a place: if Num does not hold it, it is not returned. You MUST display the returned `attribution` string wherever you show these results.",
    "inputSchema": {
      "type": "object",
      "required": [
        "destination"
      ],
      "properties": {
        "destination": {
          "type": "string",
          "description": "Destination slug or city name, e.g. \"phuket\", \"bangkok\"."
        },
        "category": {
          "type": "string",
          "description": "restaurant | bar | beach | spa | viewpoint | temple | waterfall | cafe (any case). Omit for all."
        },
        "near": {
          "type": "string",
          "description": "A \"lat,lng\" pair (e.g. \"7.8208,98.2976\") for distance-ranked results, or a neighbourhood name to filter by area, e.g. \"Kata Beach\"."
        },
        "query": {
          "type": "string",
          "description": "Free text, e.g. \"thai seafood\", \"rooftop\"."
        },
        "limit": {
          "type": "integer",
          "description": "Max results, 1–20. Default 8."
        }
      }
    }
  },
  {
    "name": "concierge_answer",
    "title": "Ask Num a travel question",
    "description": "Ask Num the way a traveller would — \"where should we eat tonight near Kata?\", \"which beach for sunset?\" — and get a short concierge answer grounded in Num's verified directory, plus the places it names as structured data so you can render your own cards. This is the whole product in one tool. It answers about the place asked and NEVER substitutes a different city. If Num has no coverage there it says so rather than guessing. It does not book, charge, or take personal details — send none. You MUST display the returned `attribution`.",
    "inputSchema": {
      "type": "object",
      "required": [
        "question"
      ],
      "properties": {
        "question": {
          "type": "string",
          "description": "The traveller's question, in their own words. Any language."
        },
        "destination": {
          "type": "string",
          "description": "Where they are, if you know it. Improves grounding."
        },
        "near": {
          "type": "string",
          "description": "Neighbourhood or hotel area, if known."
        },
        "language": {
          "type": "string",
          "description": "BCP-47 tag for the reply, e.g. \"th\", \"ru\". Defaults to the language of the question."
        }
      }
    }
  },
  {
    "name": "list_destinations",
    "title": "List the destinations Num covers",
    "description": "Which destinations Num covers, with the number of verified places in each. Call this FIRST when you do not know whether a city is supported — it is cheaper than a failed search and stops you promising a traveller coverage that does not exist. Coverage is honest: a destination appears here only when it has a real, maintained directory.",
    "inputSchema": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "place_details",
    "title": "Get one place in full",
    "description": "Everything Num holds on one place, by place_id from search_places: contact details, hours, rating, review count, area, category, cuisine, the venue's own short description (`about`), coordinates, `open_now` computed in the destination's timezone (true / false / null — null means Num has not verified the hours, NOT that it is closed), the booking platform and — only where a verified owner chose it — the venue's own booking page, a recently-read published price line where Num holds one, and up to 8 approved member photos plus the listing photo, each with its own `attribution` you MUST show alongside it. Use before showing a detail page or handing a traveller a phone number. Returns only what is verified — absent fields are absent because Num does not know them, never because they were omitted for brevity. Do not fill gaps from memory; an invented phone number is worse than a missing one.",
    "inputSchema": {
      "type": "object",
      "required": [
        "place_id"
      ],
      "properties": {
        "place_id": {
          "type": "string",
          "description": "From search_places."
        }
      }
    }
  },
  {
    "name": "open_places",
    "title": "Find places open at a time",
    "description": "Places that are OPEN RIGHT NOW in a destination, computed in the destination's own timezone. Businesses whose own website is a dead domain or a 404 are excluded entirely — they have closed down. IMPORTANT: only venues whose opening hours Num has verified can appear here, so a short list means thin hours coverage, NOT an empty city. Never tell a traveller \"nothing is open\" on the strength of this tool; say that these are the ones Num can confirm are open. Use search_places for the full directory.",
    "inputSchema": {
      "type": "object",
      "required": [
        "destination"
      ],
      "properties": {
        "destination": {
          "type": "string",
          "description": "Destination slug, e.g. \"los-angeles\"."
        },
        "category": {
          "type": "string",
          "description": "Exact category, e.g. \"Restaurant\". Omit for all."
        },
        "near": {
          "type": "string",
          "description": "Neighbourhood, e.g. \"Silver Lake\"."
        },
        "bookable_only": {
          "type": "boolean",
          "description": "Only venues Num can hand off a booking page for."
        },
        "limit": {
          "type": "integer",
          "description": "Max results, 1–50. Default 20."
        }
      }
    }
  },
  {
    "name": "booking_link",
    "title": "How to book a place",
    "description": "A booking page for one place with the party size, date and time ALREADY FILLED IN. This does NOT make a reservation and Num does not hold a table — the traveller completes it on the venue's own platform (OpenTable, Resy, Tock, SevenRooms, Square and others). The response always carries `booked: false` and `mode: \"deeplink\"`. You MUST NOT render this as a confirmation, and you MUST NOT tell a traveller a table is held. If the venue has no booking platform the response says so and returns the phone number instead — offer that rather than implying it cannot be visited.",
    "inputSchema": {
      "type": "object",
      "required": [
        "place_id"
      ],
      "properties": {
        "place_id": {
          "type": "string",
          "description": "From search_places or open_places."
        },
        "party": {
          "type": "integer",
          "description": "Number of covers, 1–20."
        },
        "date": {
          "type": "string",
          "description": "YYYY-MM-DD."
        },
        "time": {
          "type": "string",
          "description": "HH:MM, 24-hour, local to the venue."
        }
      }
    }
  },
  {
    "name": "get_menu",
    "title": "Read a place’s menu",
    "description": "The venue's own published menu or list of offerings — dishes, treatments, tours — grouped by the venue's sections in the venue's order. Free: included in the no-fee free tier, no key needed to try it. Written by the venue itself in its Num dashboard, not scraped: prices are exactly as the venue set them, in its own currency, each with the formatted amount, the currency code and the integer minor units. A price is what the venue says it charges, NOT a quote — never tell a traveller their bill will be that figure. An item with no price has `price: null` (or only a note such as \"market price\"); do not estimate one. If the venue has not published a menu, `sections` is empty and `note` says so — say that, never invent dishes. Age-restricted items are never shown on this surface. You MUST display the returned `attribution`.",
    "inputSchema": {
      "type": "object",
      "required": [
        "place_id"
      ],
      "properties": {
        "place_id": {
          "type": "string",
          "description": "From search_places, place_details or directory_feed."
        }
      }
    }
  },
  {
    "name": "get_reviews",
    "title": "Read reviews of a place",
    "description": "A rating SUMMARY for one place, free (included in the no-fee free tier) — no review text and no reviewer identities, ever. Returns `external` (the public rating and review count the listing carries, with `source`, the site it was read from) and `num_verified`: the average, count and 1–5 star distribution of ratings from verified guests — people who booked through Num and checked in at the venue by scanning its own code. Guests the venue comped or worked with are excluded, and Num publishes no verified average until a place has 5 such ratings (below that every number is null and `note` says why). Keep the two numbers separate; do not average them together. You MUST display the returned `attribution`.",
    "inputSchema": {
      "type": "object",
      "required": [
        "place_id"
      ],
      "properties": {
        "place_id": {
          "type": "string",
          "description": "From search_places, place_details or directory_feed."
        }
      }
    }
  },
  {
    "name": "directory_feed",
    "title": "Page through the directory",
    "description": "Bulk, paged sync of every place Num lists in one destination — free (included in the no-fee free tier; one call returns up to 200 places), for keeping your own copy of the directory current instead of searching it call by call. Ordered by place_id; pass the returned `next_cursor` back as `cursor` until it is null. Each item has the search_places fields plus cuisine, lat, lng and booking_platform. Places Num has positive evidence have closed are excluded; `trading: null` means not yet checked, NOT closed. Contains no menus, reviews or photos — call get_menu, get_reviews or place_details for those. You MUST display the returned `attribution` wherever the data is shown.",
    "inputSchema": {
      "type": "object",
      "required": [
        "destination"
      ],
      "properties": {
        "destination": {
          "type": "string",
          "description": "Destination slug from list_destinations, e.g. \"los-angeles\"."
        },
        "cursor": {
          "type": "string",
          "description": "The `next_cursor` from the previous page. Omit for the first page."
        },
        "limit": {
          "type": "integer",
          "description": "Places per page: 1–200 with an X-Partner-Key (default 100); without a key, at most 50."
        }
      }
    }
  }
];

export const TOOL_NAMES = TOOL_DEFS.map((t) => t.name);

/** Whether `name` is one of the nine captured tools. */
export function isKnownTool(name: string): boolean {
  return TOOL_NAMES.includes(name);
}

/* ------------------------------------------------------------------ */
/* Forwarding client                                                   */
/* ------------------------------------------------------------------ */

function failure(detail: string): ToolResult {
  return {
    content: [{ type: "text", text: `placeguide error: ${detail}` }],
    isError: true,
  };
}

function describeRpcError(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
    return JSON.stringify(error);
  }
  return String(error);
}

/**
 * Extract a JSON-RPC message from a response body that
 * may be plain JSON or SSE-framed. When `expectedId` is
 * given, the message carrying that id wins; otherwise
 * the last parseable message wins. Returns null when
 * nothing in the body parses as a JSON object.
 */
export function parseRpcBody(
  text: string,
  expectedId?: number,
): Record<string, unknown> | null {
  const body = text.trim();
  if (body === "") return null;
  const messages: Record<string, unknown>[] = [];
  const collect = (raw: string): void => {
    try {
      const value: unknown = JSON.parse(raw);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        messages.push(value as Record<string, unknown>);
      }
    } catch {
      // Not JSON; this candidate is ignored.
    }
  };
  if (body.includes("data:")) {
    for (const line of body.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice("data:".length).trim();
      if (payload !== "" && payload !== "[DONE]") collect(payload);
    }
  } else {
    collect(body);
  }
  if (messages.length === 0) return null;
  if (expectedId !== undefined) {
    const hit = messages.find((m) => m.id === expectedId);
    if (hit !== undefined) return hit;
  }
  return messages[messages.length - 1];
}

async function globalFetch(
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<FetchResponseLike> {
  return fetch(url, init) as unknown as FetchResponseLike;
}

/**
 * A forwarding client holding one upstream session,
 * opened lazily on the first call and reused after
 * that (for the process lifetime under the MCP server,
 * or for a single invocation under the CLI).
 */
export class PlaceguideClient {
  private readonly deps: ForwardDeps;
  private sessionId: string | null = null;
  private established = false;
  private opening: Promise<void> | null = null;
  private idSeq = 0;

  constructor(deps: ForwardDeps = {}) {
    this.deps = deps;
  }

  private fetchFn(): FetchFn {
    return this.deps.fetchFn ?? globalFetch;
  }

  private endpointUrl(): string {
    const explicit = this.deps.url?.trim();
    if (explicit) return explicit;
    const fromEnv = (this.deps.env ?? process.env).ITSNUM_MCP_URL?.trim();
    if (fromEnv) return fromEnv;
    return DEFAULT_ENDPOINT_URL;
  }

  private partnerKey(): string | null {
    const raw = (this.deps.env ?? process.env).ITSNUM_PARTNER_KEY?.trim();
    return raw ? raw : null;
  }

  private timeoutMs(): number {
    const t = this.deps.timeoutMs;
    return typeof t === "number" && t > 0 ? t : DEFAULT_TIMEOUT_MS;
  }

  private nextId(): number {
    this.idSeq += 1;
    return this.idSeq;
  }

  private async send(
    payload: unknown,
    attachSession: boolean,
  ): Promise<FetchResponseLike> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = this.partnerKey();
    if (key !== null) headers["X-Partner-Key"] = key;
    if (attachSession && this.sessionId !== null) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    try {
      return await this.fetchFn()(this.endpointUrl(), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async openSession(): Promise<void> {
    if (this.established) return;
    if (this.opening === null) {
      this.opening = (async () => {
        const initId = this.nextId();
        const initRes = await this.send(
          {
            jsonrpc: "2.0",
            id: initId,
            method: "initialize",
            params: {
              protocolVersion: PROTOCOL_VERSION,
              capabilities: {},
              clientInfo: { name: "placeguide", version: VERSION },
            },
          },
          false,
        );
        const issued = initRes.headers.get("mcp-session-id");
        if (issued) this.sessionId = issued;
        const initText = await initRes.text();
        const initMessage = parseRpcBody(initText, initId);
        if (initMessage !== null && initMessage.error) {
          throw new Error(describeRpcError(initMessage.error));
        }
        if (initRes.status < 200 || initRes.status >= 300) {
          throw new Error(`HTTP ${initRes.status}`);
        }
        if (initMessage === null && initText.trim() !== "") {
          throw new Error("malformed response");
        }
        const noteRes = await this.send(
          { jsonrpc: "2.0", method: "notifications/initialized" },
          true,
        );
        try {
          await noteRes.text();
        } catch {
          // The notification response body carries nothing we need.
        }
        this.established = true;
      })();
    }
    try {
      await this.opening;
    } catch (err) {
      this.opening = null;
      this.sessionId = null;
      throw err;
    }
  }

  /** Forward one tool call; upstream failures come back as isError results. */
  async callTool(name: string, args: ToolArgs): Promise<ToolResult> {
    try {
      await this.openSession();
    } catch (err) {
      return failure(err instanceof Error ? err.message : String(err));
    }

    const callId = this.nextId();
    let callRes: FetchResponseLike;
    try {
      callRes = await this.send(
        {
          jsonrpc: "2.0",
          id: callId,
          method: "tools/call",
          params: { name, arguments: args ?? {} },
        },
        true,
      );
    } catch (err) {
      return failure(
        `request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const message = parseRpcBody(await callRes.text(), callId);
    if (message !== null && message.error) {
      return failure(describeRpcError(message.error));
    }
    if (callRes.status < 200 || callRes.status >= 300) {
      return failure(`HTTP ${callRes.status}`);
    }
    if (message === null) return failure("malformed response");
    const result = message.result as ToolResult | undefined;
    if (result === undefined || result === null || typeof result !== "object") {
      return failure("malformed response");
    }
    // The upstream result is returned exactly as received.
    return result;
  }
}

/** Build a forwarding client; tests inject a stub fetch and env through deps. */
export function createClient(deps: ForwardDeps = {}): PlaceguideClient {
  return new PlaceguideClient(deps);
}

/** One-shot helper: a fresh client for a single call (the CLI path). */
export async function callTool(
  name: string,
  args: ToolArgs,
  deps: ForwardDeps = {},
): Promise<ToolResult> {
  return new PlaceguideClient(deps).callTool(name, args);
}
