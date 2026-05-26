# web_search

Search the web for current external information.

## Use when

- A question depends on current facts.
- You need to discover repository, documentation, release, or article URLs.
- You need sources before using `web_fetch`.

## Parameters

- `query` (required): search query.
- `maxResults` (optional): 1-10 results.
- `site` (optional): domain filter such as `github.com`.
- `browserFallback` (optional): use bundled `agent-browser` if direct search fails. Defaults to true.

## Notes

- Omitted `maxResults` defaults to 5; omitted `browserFallback` defaults to true. A `Note:` in the result explains any defaults applied.

## Workflow

1. Call `web_search` with a focused query.
2. Pick relevant result URLs.
3. Call `web_fetch` on exact URLs before relying on details.
