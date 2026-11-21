// What PRISM's backend needs to serve /mcp itself (MCP-O): the same server
// and tools as the standalone program, and the SDK's HTTP transport, all
// from this package's own dependencies.
export { createMcpServer } from './server.js';
export { PrismClient } from './prismClient.js';
export { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
