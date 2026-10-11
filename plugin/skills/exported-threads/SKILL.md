---
name: exported-threads
description: Use when the user asks about Reddit or Hacker News threads they exported with the Comment Scraper browser extension, for example to list their exports, summarize a thread, find what people complain about, search across threads, or quote and check a comment by its [cN] number.
---

# Working with Comment Scraper exports

The comment-scraper MCP server reads the JSON files the Comment Scraper extension saves to the user's Downloads folder and the folders directly inside it. It only reads those files and can't fetch anything new. Don't try to download a thread from Reddit or Hacker News yourself. If the thread the user means isn't in `list_threads`, ask them to export it.

## Tools

- `list_threads`: every exported thread, newest first, with its id (like `reddit:1abcxyz`) and how many comments were fetched. Start here.
- `read_thread`: the post and its comments as numbered Markdown, 200 comments per page by default. When a page tells you to call `read_thread` again with an offset, keep reading before you say anything about the whole thread. `min_score` keeps only comments at or above that score and leaves out comments whose score is hidden.
- `search_comments`: comments that contain all of the given words, across every export or within one thread, highest score first.
- `get_comment`: one comment with the comments it replies to and its direct replies.

The `thread` argument takes the id or a few words from the title.

## Citing comments

- Every comment has a number like `[c12]`. The same number is in the extension's Markdown export of that thread, so the user can look it up.
- Cite only numbers the tools returned. Never make one up or renumber comments.
- Quote comment text exactly as returned. If you paraphrase, say so.
- A reply often reads differently next to its parent. Check it with `get_comment` before you build a point on it.

## Say what the export covers

Each thread reports how many comments were fetched, how many were known but not fetched, and the total the site reports. If the export is partial, or you read only some pages or only high-scoring comments, say so in your answer.

## When no exports are found

Tell the user to:

1. Install the Comment Scraper browser extension (comment-scraper.com).
2. Open the thread, export it, and choose "JSON, one row per comment" or "JSON, replies nested". CSV and Markdown files aren't read.
3. Keep the file in Downloads or a folder directly inside it. For another folder, set `COMMENT_SCRAPER_DIRS` to that folder in the environment the app starts from, then restart the app.

## Privacy

Exports don't include usernames, but comment text can mention people by name. What you read through these tools goes to the model provider like the rest of the conversation. The server makes no network requests and never changes the user's files.
