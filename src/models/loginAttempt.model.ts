import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
} from "mongoose";

export interface ILoginAttempt {
  key: string; // e.g. login + ip
  login: string;
  ipAddress: string;
  failures: number;
  lockedUntil: Date | null;
  lastAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type LoginAttemptDocument = HydratedDocument<ILoginAttempt>;

const LoginAttemptSchema = new Schema<ILoginAttempt>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    login: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    ipAddress: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    failures: {
      type: Number,
      default: 0,
      min: 0,
    },
    lockedUntil: {
      type: Date,
      default: null,
      index: true,
    },
    lastAttemptAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

LoginAttemptSchema.index({ updatedAt: 1 });

export const LoginAttemptModel: Model<ILoginAttempt> =
  (models.LoginAttempt as Model<ILoginAttempt>) ||
  model<ILoginAttempt>("LoginAttempt", LoginAttemptSchema);

export default LoginAttemptModel;