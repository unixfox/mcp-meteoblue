#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

try {
  const server = createServer();
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(`mcp-meteoblue: ${error.message}`);
  process.exit(1);
}
