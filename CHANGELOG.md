# Changelog

## 0.1.0 (2026-10-28)

- First release: a forwarding client for the hosted itsnum places MCP server, serving the nine captured tools locally for tools/list and forwarding every tools/call upstream over a streamable-HTTP JSON-RPC session (initialize, notifications/initialized, tools/call, honouring the Mcp-Session-Id header when issued).
- Tools: `search_places`, `concierge_answer`, `list_destinations`, `place_details`, `open_places`, `booking_link`, `get_menu`, `get_reviews`, and `directory_feed`. No tool in this surface makes a reservation, takes a payment, or creates an account; `booking_link` returns a pre-filled booking page on the venue's own platform for the traveller to complete there.
- Upstream results pass through verbatim; upstream failures surface as `placeguide error:` text results.
- One bin serves the CLI (one subcommand per tool, plus `--version`) and the stdio MCP server (`mcp` subcommand). Upstream endpoint overridable via `ITSNUM_MCP_URL`; when `ITSNUM_PARTNER_KEY` is set it is sent as an `X-Partner-Key` header on every upstream request.
