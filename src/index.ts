#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import { gatherDeveloperContext } from './tools/gatherContext.js';

// Load environment variables
dotenv.config();

// Define the tool input schema
const GatherContextSchema = z.object({
  query: z.string().describe('The search query or question'),
  sources: z.array(z.enum(['stackoverflow', 'github']))
    .optional()
    .default(['stackoverflow', 'github'])
    .describe('Which sources to search'),
  maxResults: z.number()
    .optional()
    .default(5)
    .describe('Maximum results per source'),
  depth: z.enum(['quick', 'thorough'])
    .optional()
    .default('quick')
    .describe('Search depth - quick for fast results, thorough for comprehensive search'),
});

// Create the MCP server
const server = new Server(
  {
    name: process.env.MCP_SERVER_NAME || 'devscope-context-gatherer',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'gather_developer_context',
        description: 'Gather comprehensive context from developer sources (Stack Overflow, GitHub) for a given query',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query or question',
            },
            sources: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['stackoverflow', 'github'],
              },
              description: 'Which sources to search',
              default: ['stackoverflow', 'github'],
            },
            maxResults: {
              type: 'number',
              description: 'Maximum results per source',
              default: 5,
            },
            depth: {
              type: 'string',
              enum: ['quick', 'thorough'],
              description: 'Search depth - quick for fast results, thorough for comprehensive search',
              default: 'quick',
            },
          },
          required: ['query'],
        },
      },
    ],
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'gather_developer_context') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  // Validate the input
  const args = GatherContextSchema.parse(request.params.arguments);

  try {
    // Call the main function to gather context
    const result = await gatherDeveloperContext({
      query: args.query,
      sources: args.sources as ('stackoverflow' | 'github')[],
      maxResults: args.maxResults,
      depth: args.depth as 'quick' | 'thorough',
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    console.error('Error gathering context:', error);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'Failed to gather context',
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
        },
      ],
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('DevScope MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});