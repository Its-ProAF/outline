import { z } from "zod";
import {
  buildOAuthUser,
  callMcpTool,
  mcpHeaders,
  mcpRequest,
  parseMcpResponse,
} from "@server/test/McpHelper";
import { buildOAuthAuthentication } from "@server/test/factories";
import { getTestServer } from "@server/test/support";

const server = getTestServer();
const ref = z.object({ id: z.uuid(), version: z.number() });
const values = {
  site: "https://example.org",
  username: "mcp-user",
  password: "fake-mcp-secret",
  notes: "keep these notes",
};

describe("password MCP tools", () => {
  it("supports create, list, read, partial update and delete through OAuth", async () => {
    const { accessToken } = await buildOAuthUser();
    const created = await callMcpTool(
      server,
      accessToken,
      "create_password",
      values
    );
    expect(created?.result?.isError).not.toBe(true);
    const entry = ref.parse(
      JSON.parse(created?.result?.content?.[0]?.text ?? "{}")
    );
    const listed = await callMcpTool(server, accessToken, "list_passwords");
    expect(JSON.stringify(listed)).toContain(entry.id);
    expect(JSON.stringify(listed)).not.toContain(values.password);
    const read = await callMcpTool(server, accessToken, "get_password", {
      id: entry.id,
    });
    expect(JSON.stringify(read)).toContain(values.password);
    const updated = await callMcpTool(server, accessToken, "update_password", {
      ...entry,
      username: "changed",
    });
    expect(updated?.result?.isError).not.toBe(true);
    expect(JSON.stringify(updated)).toContain(values.notes);
    const stale = await callMcpTool(server, accessToken, "update_password", {
      ...entry,
      username: "stale",
    });
    expect(stale?.result?.isError).toBe(true);
    const deleted = await callMcpTool(server, accessToken, "delete_password", {
      id: entry.id,
      version: 2,
    });
    expect(deleted?.result?.isError).not.toBe(true);
    const missing = await callMcpTool(server, accessToken, "get_password", {
      id: entry.id,
    });
    expect(missing?.result?.isError).toBe(true);
  });

  it("does not expose password tools to document-only tokens or write tools to read-only tokens", async () => {
    const { user } = await buildOAuthUser();
    for (const scope of [["documents:read"], ["passwords:read"]]) {
      const auth = await buildOAuthAuthentication({ user, scope });
      const { body } = mcpRequest("tools/list");
      const res = await server.post("/mcp/", {
        headers: mcpHeaders(auth.accessToken ?? ""),
        body,
      });
      const result = JSON.stringify(await parseMcpResponse(res));
      expect(result).not.toContain('"create_password"');
      expect(result).not.toContain('"update_password"');
      expect(result).not.toContain('"delete_password"');
      if (scope[0] === "documents:read") {
        expect(result).not.toContain('"get_password"');
      } else {
        expect(result).toContain('"get_password"');
      }
      const denied = await callMcpTool(
        server,
        auth.accessToken ?? "",
        "create_password",
        values
      );
      expect(denied?.error || denied?.result?.isError).toBeTruthy();
    }
  });
});
