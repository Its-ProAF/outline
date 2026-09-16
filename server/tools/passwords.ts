import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import AuthenticationHelper from "@shared/helpers/AuthenticationHelper";
import {
  PasswordFields,
  PasswordListInput,
  PasswordRef,
  PasswordUpdateInput,
  PasswordVersionRef,
} from "plugins/passwords/shared/schema";
import { PasswordService } from "plugins/passwords/server/service";
import { error, getActorFromContext, success } from "./util";

/** Registers credential tools with the same scope and authorization rules as the API. */
export function passwordTools(server: McpServer, scopes: string[]) {
  if (AuthenticationHelper.canAccess("passwords.list", scopes)) {
    server.registerTool(
      "list_passwords",
      {
        description:
          "List workspace credentials, without passwords. Paginate using offset and limit.",
        inputSchema: PasswordListInput.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          const user = getActorFromContext(extra);
          return success(await PasswordService.list(user, input));
        } catch (err) {
          return error(err);
        }
      }
    );
  }
  if (AuthenticationHelper.canAccess("passwords.info", scopes)) {
    server.registerTool(
      "get_password",
      {
        description:
          "Read a single credential including its secret. Use only when needed for the requested task; never copy secrets to documents or logs.",
        inputSchema: PasswordRef.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          const user = getActorFromContext(extra);
          return success(await PasswordService.info(user, input.id));
        } catch (err) {
          return error(err);
        }
      }
    );
  }
  if (AuthenticationHelper.canAccess("passwords.create", scopes)) {
    server.registerTool(
      "create_password",
      {
        description:
          "Create a workspace credential. The password is encrypted in storage.",
        inputSchema: PasswordFields.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          const user = getActorFromContext(extra);
          return success(await PasswordService.create(user, input));
        } catch (err) {
          return error(err);
        }
      }
    );
  }
  if (AuthenticationHelper.canAccess("passwords.update", scopes)) {
    server.registerTool(
      "update_password",
      {
        description:
          "Update supplied credential fields. Supply the current version from list_passwords or get_password to prevent overwriting concurrent edits.",
        inputSchema: PasswordUpdateInput.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          const user = getActorFromContext(extra);
          return success(await PasswordService.update(user, input));
        } catch (err) {
          return error(err);
        }
      }
    );
  }
  if (AuthenticationHelper.canAccess("passwords.delete", scopes)) {
    server.registerTool(
      "delete_password",
      {
        description:
          "Permanently delete one workspace credential. Requires its current version.",
        inputSchema: PasswordVersionRef.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          const user = getActorFromContext(extra);
          return success(await PasswordService.delete(user, input));
        } catch (err) {
          return error(err);
        }
      }
    );
  }
}
