<div align="center">

![DevScope Logo](./assets/devscopelogo.png)

# DevScope MCP Server - Smart Context Gatherer

A Model Context Protocol (MCP) server that provides AI coding tools with comprehensive, up-to-date context from multiple developer sources.

</div>

## Features

- **Multi-Source Search**: Searches Stack Overflow, GitHub, and Reddit simultaneously
- **Intelligent Ranking**: Weighted scoring based on relevance, recency, and community signals
- **Rate Limiting**: Respects API limits with intelligent throttling
- **Caching**: In-memory LRU cache for improved performance
- **Graceful Degradation**: Returns partial results if one source fails
- **Version Awareness**: Extracts and highlights version-specific information

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your API keys:
   - `GITHUB_TOKEN`: Personal access token from GitHub
   - `STACKOVERFLOW_KEY`: API key from Stack Exchange

4. Build the TypeScript code:
   ```bash
   npm run build
   ```

## Configuration

### For Claude Code

Add to your Claude Code configuration file (`~/.claude/mcp.json` or project-specific):

```json
{
  "mcpServers": {
    "devscope": {
      "command": "node",
      "args": ["C:/Users/Ben/Desktop/devscope-project/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "your_github_token",
        "STACKOVERFLOW_KEY": "your_stackoverflow_key"
      }
    }
  }
}
```

### For Cursor

Add to your Cursor configuration file (`~/.cursor/mcp.json`):

```json
{
  "devscope": {
    "command": "node",
    "args": ["C:/Users/Ben/Desktop/devscope-project/dist/index.js"],
    "env": {
      "GITHUB_TOKEN": "your_github_token",
      "STACKOVERFLOW_KEY": "your_stackoverflow_key"
    }
  }
}
```

## Usage

Once configured, the MCP server provides a `gather_developer_context` tool that AI agents can call:

```typescript
gather_developer_context({
  query: "how to handle rate limiting in Node.js",
  sources: ["stackoverflow", "github", "reddit"],
  maxResults: 5,
  depth: "quick"
})
```

### Parameters

- `query` (required): The search query or question
- `sources` (optional): Array of sources to search. Default: `["stackoverflow", "github", "reddit"]`
- `maxResults` (optional): Maximum results per source. Default: `5`
- `depth` (optional): Search depth - `"quick"` or `"thorough"`. Default: `"quick"`

### Response

The tool returns structured context including:
- **summary**: Overview of findings
- **highlights**: Key points and solutions
- **citations**: Source links with metadata
- **snippets**: Relevant code examples
- **stats**: Performance metrics and source information

## Development

### Run in development mode:
```bash
npm run dev
```

### Build for production:
```bash
npm run build
```

### Project Structure:
```
src/
├── index.ts                 # MCP server entry point
├── tools/
│   └── gatherContext.ts     # Main tool implementation
├── adapters/
│   ├── stackoverflow.ts     # Stack Overflow API adapter
│   ├── github-rest.ts      # GitHub REST API adapter
│   └── reddit.ts           # Reddit API adapter
├── core/
│   ├── ranker.ts           # Result ranking logic
│   └── aggregator.ts       # Result aggregation
├── utils/
│   ├── rateLimiter.ts      # Rate limiting utilities
│   ├── cache.ts            # Caching implementation
│   └── errorHandler.ts     # Error handling
└── types/
    └── index.ts            # TypeScript interfaces
```

## API Rate Limits

- **Stack Overflow**: 100 requests per minute (free tier)
- **GitHub**: 5,000 points per hour (authenticated)

The server automatically handles rate limiting and will gracefully degrade if limits are reached.

## License

MIT