# Comment Scraper plugin

Ask about the Reddit and Hacker News threads you exported with the [Comment Scraper](https://comment-scraper.com) browser extension, without pasting them in. The plugin gives the agent four read-only tools (list your exports, read a thread, search across them, show one comment in context) and a skill that tells it how to use them and cite comments by their `[c12]` numbers. The numbers match the extension's Markdown export, so you can find any quoted comment in your file.

## What you need

- The Comment Scraper browser extension, with at least one thread exported as JSON: "JSON, one row per comment" or "JSON, replies nested". CSV and Markdown exports aren't read.
- Node.js 20 or newer.

## Install

In Claude Code:

```
/plugin marketplace add supertj/comment-scraper-mcp
/plugin install comment-scraper@comment-scraper
```

Or from a terminal:

```sh
claude plugin install comment-scraper --marketplace supertj/comment-scraper-mcp
```

## What it runs

When the plugin starts, the app runs `npx -y comment-scraper-mcp@0.1.0`. The first time, npx downloads that exact version of the `comment-scraper-mcp` package from npm; after that it starts from the local cache. The server's source is in this repository.

The server reads JSON exports in your Downloads folder and the folders directly inside it. It recognises them by their content, so renamed files are fine. To read another folder, set `COMMENT_SCRAPER_DIRS` to one or more folders (separated by `:`, or `;` on Windows) in the environment the app starts from.

It doesn't write, move or delete files, and it makes no network requests. What the agent reads through it goes to your model provider, like the rest of the conversation. Exports don't contain usernames.

## Things to ask

- "List my exported threads."
- "Read the CRM thread and group the complaints about pricing. Cite comment numbers."
- "Search my exports for 'switched from' and summarise what people moved to."
- "Show c41 in context."

## Already added the server by hand?

If you added `comment-scraper-mcp` yourself before, with `claude mcp add` or in your MCP settings, remove that entry (in Claude Code: `claude mcp remove comment-scraper`), or the agent sees every tool twice.

## Support

Email hello@comment-scraper.com. Privacy policy: https://comment-scraper.com/privacy

## License

MIT
