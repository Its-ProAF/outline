import { Hook, PluginManager } from "@server/utils/PluginManager";
import githubEnv from "plugins/github/server/env";
import config from "../plugin.json";
import router from "./api/board";

const enabled =
  !!githubEnv.GITHUB_CLIENT_ID &&
  !!githubEnv.GITHUB_CLIENT_SECRET &&
  !!githubEnv.GITHUB_APP_ID &&
  !!githubEnv.GITHUB_APP_PRIVATE_KEY;

if (enabled) {
  PluginManager.add({
    ...config,
    type: Hook.API,
    value: router,
  });
}
