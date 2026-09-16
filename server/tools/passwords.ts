import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import AuthenticationHelper from "@shared/helpers/AuthenticationHelper";
import {
  PasswordFields,
  FactorReadInput,
  PasskeyReleaseInput,
  TotpSaveInput,
  PasskeySaveInput,
  FindLoginInput,
  PasswordListInput,
  PasswordRef,
  PasswordUpdateInput,
  PasswordVersionRef,
} from "plugins/passwords/shared/schema";
import { PasswordService } from "plugins/passwords/server/service";
import { LoginFactors } from "plugins/passwords/server/factors";
import { error, getActorFromContext, success } from "./util";

/** Registers credential tools with the same scope and authorization rules as the API. */
export function passwordTools(server: McpServer, scopes: string[]) {
  if (AuthenticationHelper.canAccess("passwords.findLogin", scopes)) {
    server.registerTool(
      "get_login_instructions",
      {
        description:
          "Read the agent login workflow for password, TOTP and passkey use, including browser requirements and first enrollment. Call before automating login.",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async () =>
        success({
          workflow: [
            "Follow the user's and workspace's standing authorization for ordinary login; do not expand the requested task's scope.",
            "Open the login page and use find_login with its exact HTTPS origin and the requested account. loginUrl overrides site when the provider authenticates on a different domain. Resolve ambiguous accounts before using secrets.",
            "Use get_password only on the configured login origin. Use get_totp immediately before submitting its code, respecting expiresAt. Setup seeds never leave the server through read tools.",
            "Passkeys require a Chromium browser with the CDP WebAuthn domain. Use the browser helper below: withPasskey loads the key, limits use to the lease, removes the authenticator and calls release_passkey in finally. Do not retain or reuse exported material. A tool response alone does not give any browser passkey support.",
            "For first enrollment, authenticate to the target site, create an entry in the Password section, call beginPasskeyRegistration, create the passkey through the target site's security settings, then call save only after the site confirms registration. Keep the handle and browser alive and retry if vault saving fails. Existing hardware/iCloud passkeys cannot be extracted by this flow.",
            "Verify the authenticated account and page, not just form submission. For a clean-session test use a fresh browser context without cookies, storageState or a personal profile. A new tab is not enough.",
            "Keep secrets in memory and transmit them only to their intended service. Report only outcomes. CAPTCHA, physical-device checks, missing factors or unsupported browsers may still need the owner; explain the specific blocker.",
          ],
          helper:
            "https://github.com/Its-ProAF/outline/blob/board/plugins/passwords/agent/browser.mjs",
          methods: [
            "createVaultClient",
            "findLogin",
            "beginPasskeyRegistration",
            "withPasskey",
            "getTotp",
          ],
          clientSetup:
            "Use OUTLINE_URL and an authorized OUTLINE_API_KEY in process environment for the browser helper. Reconnect MCP if the new tools are absent. passwords:read permits login, passwords:write permits setup.",
        })
    );
  }

  if (AuthenticationHelper.canAccess("passwords.releasePasskey", scopes)) {
    server.registerTool(
      "release_passkey",
      {
        description:
          "Release a passkey browser lease after removing its virtual authenticator. Always call in finally. Keep the lease ID private.",
        inputSchema: PasskeyReleaseInput.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          return success(
            await LoginFactors.releasePasskey(getActorFromContext(extra), input)
          );
        } catch (err) {
          return error(err);
        }
      }
    );
  }

  if (AuthenticationHelper.canAccess("passwords.findLogin", scopes)) {
    server.registerTool(
      "find_login",
      {
        description:
          "Find login entries by exact HTTPS login origin and optional username. Returns IDs, names and available methods without secrets. Use before requesting login credentials.",
        inputSchema: FindLoginInput.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          return success(
            await LoginFactors.find(getActorFromContext(extra), input)
          );
        } catch (err) {
          return error(err);
        }
      }
    );
  }
  if (AuthenticationHelper.canAccess("passwords.setTotp", scopes)) {
    server.registerTool(
      "configure_totp",
      {
        description:
          "Save a TOTP setup key or otpauth URI encrypted on a login entry, or remove with null. Requires current version. Never put the setup secret in notes or logs.",
        inputSchema: TotpSaveInput.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          return success(
            await LoginFactors.setTotp(getActorFromContext(extra), input)
          );
        } catch (err) {
          return error(err);
        }
      }
    );
  }
  if (AuthenticationHelper.canAccess("passwords.totp", scopes)) {
    server.registerTool(
      "get_totp",
      {
        description:
          "Get a current TOTP code and expiry for the exact configured login origin. The setup seed is never returned. Use only for an authorized login.",
        inputSchema: FactorReadInput.shape,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          return success(
            await LoginFactors.totp(getActorFromContext(extra), input)
          );
        } catch (err) {
          return error(err);
        }
      }
    );
  }
  if (AuthenticationHelper.canAccess("passwords.setPasskey", scopes)) {
    server.registerTool(
      "save_passkey",
      {
        description:
          "Save a dedicated resident ES256 software passkey created on the target website by the agent browser helper, or remove with null. Requires current version. Not a way to export hardware or iCloud passkeys.",
        inputSchema: PasskeySaveInput.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          return success(
            await LoginFactors.setPasskey(getActorFromContext(extra), input)
          );
        } catch (err) {
          return error(err);
        }
      }
    );
  }
  if (AuthenticationHelper.canAccess("passwords.passkey", scopes)) {
    server.registerTool(
      "get_passkey",
      {
        description:
          "Retrieve private passkey material only for its configured login origin. Requires a Chromium browser with WebAuthn CDP support. Returns a two-minute exclusive lease and reserved counter range. Use the agent browser helper, remove the authenticator and call release_passkey in finally. Never log or save plaintext.",
        inputSchema: FactorReadInput.shape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (input, extra) => {
        try {
          return success(
            await LoginFactors.passkey(getActorFromContext(extra), input)
          );
        } catch (err) {
          return error(err);
        }
      }
    );
  }

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
