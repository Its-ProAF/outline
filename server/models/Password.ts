import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  hkdfSync,
} from "node:crypto";
import type { InferAttributes, InferCreationAttributes } from "sequelize";
import { Column, DataType, ForeignKey, Table } from "sequelize-typescript";
import env from "@server/env";
import {
  PasswordFields,
  type PasswordCategoryValue,
  type PasswordValues,
} from "plugins/passwords/shared/schema";
import IdModel from "./base/IdModel";
import Team from "./Team";

/** A workspace credential, encrypted independently from document content. */
@Table({ tableName: "passwords", modelName: "password", paranoid: false })
export class Password extends IdModel<
  InferAttributes<Password>,
  Partial<InferCreationAttributes<Password>>
> {
  @ForeignKey(() => Team)
  @Column(DataType.UUID)
  teamId: string;

  @Column(DataType.BLOB)
  sealed: Buffer;

  @Column(DataType.INTEGER)
  version: number;

  @Column({ type: DataType.STRING, defaultValue: "password" })
  category: PasswordCategoryValue;

  /** Encrypts all credential fields and authenticates the workspace and record identity. */
  seal(values: PasswordValues) {
    this.category = values.category ?? this.category ?? "password";
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), nonce);
    cipher.setAAD(Buffer.from(`${this.teamId}:${this.id}`));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(values), "utf8"),
      cipher.final(),
    ]);
    this.sealed = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  }

  /** Decrypts credential fields, rejecting corrupt or substituted ciphertext. */
  open(): PasswordValues {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      this.sealed.subarray(0, 12)
    );
    decipher.setAAD(Buffer.from(`${this.teamId}:${this.id}`));
    decipher.setAuthTag(this.sealed.subarray(12, 28));
    const plaintext = Buffer.concat([
      decipher.update(this.sealed.subarray(28)),
      decipher.final(),
    ]);
    return PasswordFields.parse(JSON.parse(plaintext.toString("utf8")));
  }

  private key() {
    return Buffer.from(
      hkdfSync(
        "sha256",
        Buffer.from(env.SECRET_KEY, "hex"),
        this.teamId,
        "outline-passwords-v1",
        32
      )
    );
  }
}
