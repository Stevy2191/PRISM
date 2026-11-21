// Loads the MCP server and tools shared with the standalone program in
// mcp/ (MCP-O). In the image they're at PRISM_MCP_DIR (/mcp); in a checkout,
// next to backend/.
const path = require('path');
const { pathToFileURL } = require('url');

let loaded = null;

function mcpDir() {
  return process.env.PRISM_MCP_DIR || path.resolve(__dirname, '../../../mcp');
}

function loadMcp() {
  if (!loaded) {
    loaded = import(pathToFileURL(path.join(mcpDir(), 'src', 'embed.js')).href);
    loaded.catch(() => { loaded = null; });
  }
  return loaded;
}

module.exports = { loadMcp, mcpDir };
