import "server-only";

import { Schema, type InferSchemaType, type Types } from "mongoose";

import { defineModel } from "./define-model.ts";

/**
 * An operator with access to the admin area.
 *
 * Deliberately minimal: Auth.js owns the session, this collection owns only
 * the identity and the credential. Admin accounts are provisioned
 * out-of-band — there is no public sign-up route to this collection, and
 * there should never be one.
 *
 * `hashedPassword` is select:false so an accidental `findOne()` in an
 * unrelated code path cannot pull a credential hash into a response payload.
 * Reading it requires asking for it explicitly.
 */
const adminUserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    /** Argon2id or bcrypt digest. A plaintext password is never stored. */
    hashedPassword: { type: String, required: true, select: false },

    role: {
      type: String,
      enum: ["admin", "operator"],
      required: true,
      default: "operator",
    },

    /** Disables access without destroying the audit trail. */
    isActive: { type: Boolean, required: true, default: true },

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type AdminUser = InferSchemaType<typeof adminUserSchema> & {
  _id: Types.ObjectId;
};

export const AdminUserModel = defineModel("AdminUser", adminUserSchema);
