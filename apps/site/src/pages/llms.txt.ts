import { manual, docUrl } from '../lib/docs';
export async function GET() {
  const pages = await manual();
  const text = `# OpenRoom\n\n> Decks, shared spaces, live participation, and learner follow-up.\n\n## User manual\n\n${pages.map((page) => `- [${page.data.title}](https://openroom.app${docUrl(page.id)}): ${page.data.description}`).join('\n')}\n\n## Interfaces\n\n- [Complete manual](https://openroom.app/llms-full.txt)\n- [MCP server card](https://openroom.app/.well-known/mcp/server-card.json): connection and discovery\n- [OpenAPI](https://openroom.app/openapi.json): HTTP contracts\n- [Host workspace](https://openroom.app/host/)\n- [Join a session](https://join.openroom.app/)\n\nUse the connected MCP server's instructions and tool descriptions for tool arguments and behavior. The manual covers the current build; installation and service requirements appear in the relevant chapters.\n`;
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
