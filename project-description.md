# This is the core .md file of the project
- this should be a quick-and-dirty prototype

<idea>
Build a Smart Context Gatherer MCP Server that provides AI coding tools (Claude Code, Cursor, etc.) with a powerful tool to gather comprehensive context from multiple developer sources. 

The server provides a `gather_developer_context` tool that AI agents can call when they need current information about technologies, frameworks, or issues. The AI agent determines what to search for and when, passing relevant keywords and technologies to the MCP.

The MCP then searches GitHub issues, Stack Overflow Q&A, Reddit discussions, npm packages, and documentation sites, aggregating this information into structured, relevant context for the AI to use in its response.

The goal is to eliminate outdated responses and ensure the AI has access to the latest solutions, edge cases, and community discussions whenever it needs them.
</idea>

## Tech Stack

**Language:** Python or TypeScript (for MCP SDK compatibility)
- MCP Framework: Official MCP SDK (@modelcontextprotocol/sdk)

**APIs:** GitHub API (issues, PRs, discussions), Stack Overflow API (questions, answers), Reddit API (developer subreddits), npm API (package metadata, vulnerabilities)
- Built-in Tools: Uses AI agent's web search + web fetch capabilities

**Detection:** Tool-based approach - AI agent determines when and what to search
- Rate Limiting: Built-in rate limiting for API calls
- Caching: In-memory caching for repeated queries

**Configuration:** Environment variables for API keys
- Integration: Compatible with Claude Code, Cursor, Windsurf

## Features

**Core Functionality:** AI-called context gathering tool, parallel searching across 5+ data sources
- Intelligent result aggregation and ranking
- Context formatting optimized for AI consumption

**Performance:** Rate limiting and error handling, configurable search depth and sources
- Session-based caching for performance
- Support for multiple programming languages/frameworks