import { addSeconds } from "date-fns";
import { Op } from "sequelize";
import { IntegrationService } from "@shared/types";
import type { User } from "@server/models";
import { IntegrationAuthentication } from "@server/models";
import type { TokenRefreshResponse } from "@server/models/IntegrationAuthentication";
import { sequelize } from "@server/storage/database";
import type { GitHubUser } from "./github";
import { BoardGitHub } from "./github";

// IntegrationAuthentication has no free field and GitHub App user tokens carry no OAuth scopes,
// so scopes hold the board marker and the GitHub identity of the user.
const LinkScope = "board";
const IdScopePrefix = "github_user_id:";
const LoginScopePrefix = "github_login:";

export type GitHubLinkToken = { token: string; login: string | null };

/** The per-user link between an Outline user and their GitHub account. */
export class GitHubLink {
  static find(user: User) {
    return IntegrationAuthentication.findOne({
      where: this.where(user),
      order: [["createdAt", "DESC"]],
    });
  }

  /**
   * Stores the user tokens, replacing any previous link of the user.
   *
   * @param user the Outline user.
   * @param tokens the tokens returned by GitHub.
   * @param githubUser the GitHub account the tokens belong to.
   */
  static async save(
    user: User,
    tokens: TokenRefreshResponse,
    githubUser: GitHubUser
  ) {
    await sequelize.transaction(async (transaction) => {
      await IntegrationAuthentication.destroy({
        where: this.where(user),
        transaction,
      });
      await IntegrationAuthentication.create(
        {
          service: IntegrationService.GitHub,
          userId: user.id,
          teamId: user.teamId,
          token: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_in
            ? addSeconds(Date.now(), tokens.expires_in)
            : null,
          scopes: [
            LinkScope,
            `${IdScopePrefix}${githubUser.id}`,
            `${LoginScopePrefix}${githubUser.login}`,
          ],
        },
        { transaction }
      );
    });
  }

  /**
   * Returns a valid user token, refreshing it when close to expiry.
   *
   * @param user the Outline user.
   * @returns the token and GitHub login, or null when the user is not linked.
   */
  static async token(user: User): Promise<GitHubLinkToken | null> {
    const auth = await this.find(user);
    if (!auth) {
      return null;
    }

    const token = await auth.refreshTokenIfNeeded((refreshToken) =>
      BoardGitHub.refreshUserToken(refreshToken)
    );
    // refreshTokenIfNeeded swallows refresh errors: an expired token means the link is gone.
    if (auth.expiresAt && auth.expiresAt <= new Date()) {
      await auth.destroy();
      return null;
    }

    const login = auth.scopes
      .find((s) => s.startsWith(LoginScopePrefix))
      ?.slice(LoginScopePrefix.length);
    return { token, login: login ?? null };
  }

  static async disconnect(user: User) {
    await IntegrationAuthentication.destroy({ where: this.where(user) });
  }

  private static where(user: User) {
    return {
      service: IntegrationService.GitHub,
      userId: user.id,
      teamId: user.teamId,
      scopes: { [Op.contains]: [LinkScope] },
    };
  }
}
