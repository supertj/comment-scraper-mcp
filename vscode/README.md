# Comment Scraper MCP

Ask VS Code chat about the Reddit and Hacker News threads you exported with <a href="https://comment-scraper.com">Comment Scraper</a>, without pasting them in.

This extension adds a small MCP server that reads the JSON files the Comment Scraper Chrome extension saves to your Downloads folder. Chat gets four tools to list, read and search them. Comments keep the same numbers as the extension's Markdown export, like `[c12]`, so when chat quotes a comment you can find it in the file.

It runs on your computer, only reads files, and makes no network requests.

## Before you start

1. Install the free Comment Scraper extension for Chrome.
2. Export a thread and pick **JSON, one row per comment** or **JSON, replies nested**. CSV and Markdown files aren't read.

You need VS Code 1.101 or newer, with chat set up. You don't need Node.js: the server runs on the Node that ships with VS Code, and nothing is downloaded when it starts.

## Use it

Open the Chat view in agent mode and ask about your exports. VS Code starts the server the first time chat needs it. The four tools are listed under Comment Scraper in **Configure Tools**, and **MCP: List Servers** in the Command Palette shows whether the server is running.

Things to ask:

- "List my exported threads."
- "Read the CRM thread and group the complaints about pricing. Cite comment numbers."
- "Search my exports for 'switched from' and summarise what people moved to."
- "Show c41 in context."

## Tools

| Tool | What it does |
|---|---|
| `list_threads` | Your exported threads, newest first, with how many comments were fetched and how many the site reports |
| `read_thread` | A thread as numbered Markdown, 200 comments at a time, optionally only comments above a score |
| `search_comments` | Comments containing all of your words, across every export or one thread, highest score first |
| `get_comment` | One comment with the replies it answers and the replies to it |

## Where it looks

By default it reads your Downloads folder and the folders directly inside it, so moving exports into a project folder there is fine. Files are recognised by their content, so renaming them is fine too. If you export the same thread twice, the newest export is used.

To read somewhere else, set `commentScraper.exportFolders` in your user settings:

```json
"commentScraper.exportFolders": ["~/Research/reddit"]
```

Use full paths or paths starting with `~`. Each folder and the folders directly inside it are read. When you change the setting, VS Code stops the server and starts it again with the new folders the next time chat uses one of the tools. If you set `COMMENT_SCRAPER_DIRS` for another app, VS Code ignores it; only this setting counts here.

## Privacy

The server reads JSON files in the folders above and nothing else. It doesn't write, move or delete files, and it doesn't connect to the internet. What you ask in chat, and the comments chat reads through these tools, go to the model provider VS Code chat is using, under their terms. Exports from the extension don't include usernames, though comment text can still mention people by name.

## Other apps

The same server works in Claude Code, Claude Desktop and other MCP clients. Setup steps are in the [Comment Scraper docs](https://comment-scraper.com/docs).

Questions or problems: hello@comment-scraper.com

## License

MIT
