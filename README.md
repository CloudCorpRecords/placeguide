# placeguide

placeguide is a small local bridge to the hosted
itsnum places MCP server, a verified directory of
places across 119 travel destinations. Ask it where
to eat in Phuket, which places in Los Angeles are
open right now, what a venue's own published menu
looks like, or how its verified guests rated it, and
the answers come from listings the directory itself
maintains — a place the directory does not hold is
never invented to fill a gap.

The package keeps no directory of its own. It answers
the tool list locally, exactly as captured from the
live endpoint, and forwards each tool call upstream,
returning whatever comes back untouched. Several of
the upstream responses carry an `attribution` string;
wherever you show those results, display it as the
captured tool descriptions require.

Three of the nine tools are described upstream as
free, in a no-fee free tier: `get_menu`,
`get_reviews`, and `directory_feed`. Nothing in this
surface makes a reservation, charges anyone, or opens
an account. `booking_link` returns a booking page on
the venue's own platform with party size, date and
time already filled in — the traveller completes the
booking there, and the response always says
`booked: false`.

## Tools

- `search_places` — find real, currently-operating
  places in a destination: restaurants, bars, beaches,
  spas, viewpoints, temples. Required: `destination`
  (slug or city name). Optional: `category`, `near`
  (a `"lat,lng"` pair for distance-ranked results
  within about 5 km, or a neighbourhood name to filter
  by area), `query` (free text), and `limit` (1–20,
  default 8). Ranked by quality — rating weighted by
  review count — or by a blend of quality and distance
  when coordinates are given. Returns name, category,
  area, rating, review count, phone, address and
  opening hours where known.
- `concierge_answer` — ask a travel question the way a
  traveller would ("where should we eat tonight near
  Kata?") and get a short answer grounded in the
  verified directory, plus the named places as
  structured data. Required: `question`. Optional:
  `destination`, `near`, and `language` (a BCP-47 tag;
  defaults to the language of the question). It
  answers about the place asked, never substitutes a
  different city, and says so when there is no
  coverage rather than guessing.
- `list_destinations` — the destinations the directory
  covers, with the number of verified places in each.
  No arguments. Call it first when you do not know
  whether a city is supported.
- `place_details` — everything held on one place, by
  `place_id` from `search_places`. Required:
  `place_id`. Returns the venue's published contact
  details from its own listing, hours, rating, review
  count, area, category, cuisine, its own short
  description, coordinates, `open_now` computed in the
  destination's timezone (null means the hours are not
  verified, not that it is closed), the booking
  platform and — only where a verified owner chose
  one — the venue's own booking page, a recently-read
  published price line where held, and photos, each
  with its own attribution.
- `open_places` — places open right now in a
  destination, computed in the destination's own
  timezone. Required: `destination`. Optional:
  `category`, `near`, `bookable_only`, and `limit`
  (1–50, default 20). Only venues with verified hours
  can appear, so a short list means thin hours
  coverage, not an empty city.
- `booking_link` — a booking page for one place with
  party size, date and time already filled in.
  Required: `place_id`. Optional: `party` (1–20),
  `date` (`YYYY-MM-DD`), and `time` (`HH:MM`, 24-hour,
  local to the venue). This does not make a
  reservation and does not hold a table; the response
  always carries `booked: false` and
  `mode: "deeplink"`. If the venue has no booking
  platform, the response says so and returns the phone
  number instead.
- `get_menu` — a venue's own published menu or list of
  offerings, grouped by the venue's sections in the
  venue's order. Required: `place_id`. Prices are
  exactly as the venue set them, in its own currency;
  an item with no price has `price: null`. If no menu
  is published, `sections` is empty and `note` says
  so. Free.
- `get_reviews` — a rating summary for one place.
  Required: `place_id`. Returns `external` (the public
  rating and count the listing carries, with its
  source) and `num_verified` (average, count and
  1–5 star distribution from verified guests). No
  review text and no reviewer identities, ever; below
  five verified ratings every verified number is null
  and `note` says why. Free.
- `directory_feed` — a bulk, paged sync of every place
  listed in one destination, up to 200 places per
  call, ordered by place_id. Required: `destination`.
  Optional: `cursor` (pass back the returned
  `next_cursor` until it is null) and `limit` (1–200
  with a partner key, default 100; at most 50 without
  a key). Each item carries the `search_places` fields
  plus cuisine, coordinates and booking platform; it
  contains no menus, reviews or photos. Free.

## Configuration

- `ITSNUM_MCP_URL` (optional) — override the upstream
  endpoint. Defaults to
  `https://app.itsnum.com/api/partner/mcp`. (The
  override hook is this rebuild's own labelled
  reconstruction.)
- `ITSNUM_PARTNER_KEY` (optional) — when set, every
  upstream request carries an
  `X-Partner-Key: <value>` header with the caller's
  own partner key. When it is not set, no key header
  is sent, and the surface still answers — the tool
  list was captured keyless, and several tools are
  described as free with no key needed. (The header
  name is pinned by the original's registry record,
  which declares a secret `X-Partner-Key` header; the
  record pins no package env name, so forwarding the
  key from this env var is a labelled reconstruction.)
  A key raises the `directory_feed` page-size ceiling
  from 50 to 200, per the captured description.

### Forwarding mechanics

On the first tool call the client opens a streamable
HTTP session upstream: a JSON-RPC `initialize`
request (protocolVersion `2025-03-26`, clientInfo
name `placeguide`), then a
`notifications/initialized` notification, then the
`tools/call` request carrying the caller's arguments
unchanged. When the upstream answers `initialize`
with an `Mcp-Session-Id` header, that value rides on
every later request of the session, which is reused
for the life of the process. Replies may arrive as
plain JSON or as server-sent events; both are read.

Successful upstream results pass through verbatim,
including any `isError` flag the upstream sets.
Failures — a JSON-RPC error, a non-2xx status, an
unreadable response, or a request that cannot be
completed — come back as an `isError` result whose
text starts with `placeguide error:` (this rendering
is this rebuild's own labelled reconstruction).

## CLI

Each tool is also a subcommand taking one JSON
argument string:

```bash
npx @reneturcios/placeguide search_places '{"destination":"phuket","category":"restaurant"}'
npx @reneturcios/placeguide list_destinations '{}'
npx @reneturcios/placeguide get_menu '{"place_id":"..."}'
npx @reneturcios/placeguide --version
```

Exit codes: `0` on success, `1` on an `isError`
result, `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/placeguide mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "placeguide": {
      "command": "npx",
      "args": ["-y", "@reneturcios/placeguide", "mcp"]
    }
  }
}
```

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/placeguide
docker run --rm ghcr.io/cloudcorprecords/placeguide --version
```

The container's default command is `mcp`, so the first
form is a stdio MCP server; any other arguments reach
the CLI normally.

## Development

```bash
npm install
npm run build
npm test
npm run dev
```

The test suite runs entirely against a stubbed
JSON-RPC upstream — no live network calls.

## License

MIT — see `LICENSE`.
