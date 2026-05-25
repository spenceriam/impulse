# web_fetch

Read an exact HTTP(S) URL and return cleaned text.

## Use when

- The user provides a URL.
- `web_search` returned a URL that needs verification.
- Current source content is needed before answering.

## Parameters

- `url` (required): HTTP(S) URL to fetch.
- `maxChars` (optional): maximum response characters, 500-50000.
- `browserFallback` (optional): use bundled `agent-browser` if direct fetch fails. Defaults to true.

## Notes

- Omitted `maxChars` defaults to 12000; omitted `browserFallback` defaults to true. A `Note:` in the result explains any defaults applied.
- Local/private network URLs are refused.
- Binary content is refused unless support is added later.
- The output includes final URL, status, title when available, content type, and cleaned text.
