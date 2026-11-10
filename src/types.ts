/**
 * Shared types for placeguide.
 *
 * placeguide holds no place data of its own. It is a
 * forwarding client: the captured tool definitions are
 * kept as plain data and served unchanged for
 * tools/list, while each tools/call is relayed to the
 * hosted itsnum places endpoint through an injectable
 * fetch, which keeps the whole client testable without
 * touching the live network.
 */

/** A single captured tool definition, served for tools/list exactly as captured. */
export interface ToolDef {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  [key: string]: unknown;
}

/** Decoded JSON arguments handed to a tool call. */
export type ToolArgs = Record<string, unknown>;

/** A tools/call result. Upstream payloads travel through untouched; local failures share this shape. */
export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

/** The slice of a fetch Response that the forwarding client actually reads. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Injectable fetch, so tests can substitute a stub upstream. */
export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

/** Dependencies a caller may inject into the forwarding client. */
export interface ForwardDeps {
  /** Fetch implementation. Falls back to the global fetch. */
  fetchFn?: FetchFn;
  /** Environment consulted for ITSNUM_MCP_URL and ITSNUM_PARTNER_KEY. Falls back to process.env. */
  env?: Record<string, string | undefined>;
  /** Explicit endpoint URL. Wins over the env override and the pinned default. */
  url?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
}
