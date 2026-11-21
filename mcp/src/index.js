#!/usr/bin/env node
// prism-mcp: lets Claude work with a PRISM help desk.
//   prism-mcp          stdio (Claude Desktop, Claude Code)
//   prism-mcp --http   Streamable HTTP on PRISM_MCP_HOST:PRISM_MCP_PORT/mcp
import { configFromEnv, runHttp, runStdio } from './server.js';

const config = configFromEnv();
const mode = process.argv.includes('--http') ? runHttp : runStdio;

mode(config).catch((err) => {
  process.stderr.write(`prism-mcp: ${err.message}\n`);
  process.exit(1);
});
