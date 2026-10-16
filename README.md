# comment-scraper-mcp

Ask Claude about the Reddit and Hacker News threads you exported with [Comment Scraper](https://comment-scraper.com), without pasting them in.

This is a small [MCP](https://modelcontextprotocol.io) server. It reads the JSON files the Comment Scraper browser extension saves to your Downloads folder and gives Claude (or any MCP client) four tools to list, read and search them. Comments keep the same numbers as the extension's Markdown export, like `[c12]`, so when Claude quotes a comment you can find it in the file.

It runs on your computer, only reads files, and makes no network requests.

## Before you start

1. Install the Comment Scraper extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/gblklncgcjcinpjaaeafmmkjnfkihmfn?utm_source=github).
2. Export a thread and pick **JSON, one row per comment** or **JSON, replies nested**. CSV and Markdown files aren't read.
3. Have Node.js 20 or newer.

## Install

**Claude Code**

```sh
claude mcp add comment-scraper -- npx -y comment-scraper-mcp
```

**Claude Desktop**: open Settings → Developer → Edit Config and add:

```json
{
  "mcpServers": {
    "comment-scraper": {
      "command": "npx",
      "args": ["-y", "comment-scraper-mcp"]
    }
  }
}
```

Restart Claude Desktop afterwards. Other MCP clients (Cursor, Windsurf and so on) take the same command: `npx -y comment-scraper-mcp`.

**As a Claude Code plugin**: the [`plugin`](plugin) folder bundles the server, pinned to a release, with a skill that tells Claude how to cite comments. This repository doubles as a plugin marketplace:

```sh
claude plugin install comment-scraper --marketplace supertj/comment-scraper-mcp
```

Use the plugin or `claude mcp add`, not both, or Claude sees every tool twice.

**As a Hermes Agent plugin**: the same folder works in Hermes Agent. The install steps are in the [plugin README](plugin/README.md#hermes-agent).

## Where it looks

By default it reads your Downloads folder and the folders directly inside it, so moving exports into a project folder there is fine. To read somewhere else, pass one or more folders:

```sh
claude mcp add comment-scraper -- npx -y comment-scraper-mcp --dir ~/Research/reddit
```

or set `COMMENT_SCRAPER_DIRS` (folders separated by `:`, or `;` on Windows). Files are recognised by their content, so renaming them is fine. If you export the same thread twice, the newest export is used.

## Tools

| Tool | What it does |
|---|---|
| `list_threads` | Your exported threads, newest first, with how many comments were fetched and how many the site reports |
| `read_thread` | A thread as numbered Markdown, 200 comments at a time, optionally only comments above a score |
| `search_comments` | Comments containing all of your words, across every export or one thread, highest score first |
| `get_comment` | One comment with the replies it answers and the replies to it |

## Things to ask

- "List my exported threads."
- "Read the CRM thread and group the complaints about pricing. Cite comment numbers."
- "Search my exports for 'switched from' and summarise what people moved to."
- "Show c41 in context."

## Privacy

The server reads JSON files in the folders above and nothing else. It doesn't write, move or delete files, and it doesn't connect to the internet. What you ask Claude, and the comments Claude reads through these tools, go to Anthropic or whichever model provider your client uses, under their terms. Exports from the extension don't contain usernames.

## License

MIT
