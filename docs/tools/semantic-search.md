# semantic_search

Search project files by concept using local lexical ranking.

## Use when

- Exact `grep` terms are not obvious.
- You need candidate files/snippets for a concept before verifying with `file_read` or `grep`.

## Parameters

- `query` required string — concept or terms to search for.
- `maxResults` optional number — maximum results, capped at 20.

## Notes

- Local-first; no remote embedding calls.
- Results are ranked hints. Verify important findings with `file_read` or `grep`.
