import httpErrors from "http-errors";
import type { z } from "zod";
import { Password, type User } from "@server/models";
import { authorize } from "@server/policies";
import { NotFoundError } from "@server/errors";
import { sequelize } from "@server/storage/database";
import {
  PasswordFields,
  type PasswordListInput,
  type PasswordUpdateInput,
  type PasswordValues,
  type PasswordVersionRef,
} from "../shared/schema";

/** Formats a credential without exposing its secret or ciphertext. */
function present(password: Password) {
  const { password: _secret, ...fields } = password.open();
  return {
    id: password.id,
    ...fields,
    category: password.category,
    version: password.version,
    createdAt: password.createdAt.toISOString(),
    updatedAt: password.updatedAt.toISOString(),
  };
}

/** Shared operations used by both authenticated API routes and MCP tools. */
export class PasswordService {
  /** Lists a bounded page without returning passwords. */
  static async list(user: User, input: z.infer<typeof PasswordListInput>) {
    authorize(user, "listPasswords", user.team);
    const { category, ...pagination } = input;
    const { rows, count } = await Password.findAndCountAll({
      where: { teamId: user.teamId, ...(category ? { category } : {}) },
      order: [
        ["createdAt", "DESC"],
        ["id", "ASC"],
      ],
      ...pagination,
    });
    return {
      entries: rows.map(present),
      total: count,
      canWrite: !user.isViewer,
    };
  }

  /** Reads one credential, including its password, on explicit request. */
  static async info(user: User, id: string) {
    const entry = await Password.findOne({
      where: { id, teamId: user.teamId },
    });
    if (!entry) {
      throw NotFoundError();
    }
    authorize(user, "read", entry);
    return { ...present(entry), password: entry.open().password };
  }

  /** Creates an encrypted credential in the caller's workspace. */
  static async create(user: User, values: PasswordValues) {
    authorize(user, "createPassword", user.team);
    const entry = Password.build({ teamId: user.teamId, version: 1 });
    entry.seal(PasswordFields.parse(values));
    await entry.save();
    return present(entry);
  }

  /** Changes only supplied fields and rejects stale edits. */
  static async update(user: User, input: z.infer<typeof PasswordUpdateInput>) {
    return sequelize.transaction(async (transaction) => {
      const entry = await Password.findOne({
        where: { id: input.id, teamId: user.teamId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!entry) {
        throw NotFoundError();
      }
      authorize(user, "update", entry);
      if (entry.version !== input.version) {
        throw httpErrors(409, "Voce modificata. Ricarica prima di salvare.");
      }
      const { id: _id, version: _version, ...changes } = input;
      entry.seal(PasswordFields.parse({ ...entry.open(), ...changes }));
      entry.version += 1;
      await entry.save({ transaction });
      return present(entry);
    });
  }

  /** Permanently removes one credential, rejecting stale deletion requests. */
  static async delete(user: User, input: z.infer<typeof PasswordVersionRef>) {
    return sequelize.transaction(async (transaction) => {
      const entry = await Password.findOne({
        where: { id: input.id, teamId: user.teamId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!entry) {
        throw NotFoundError();
      }
      authorize(user, "delete", entry);
      if (entry.version !== input.version) {
        throw httpErrors(409, "Voce modificata. Ricarica prima di eliminarla.");
      }
      await entry.destroy({ transaction });
      return { success: true };
    });
  }
}
