const mongoose = require("mongoose");

const masterSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    avatarUrl: {
      type: String,
      default: "",
    },

    avatarPublicId: {
      type: String,
      default: "",
    },

    pinHash: {
      type: String,
      required: true,
    },

    refreshTokenHash: {
      type: String,
      default: "",
    },

    role: {
      type: String,
      default: "MASTER_ADMIN",
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    googleSub: {
      type: String,
      default: "",
    },

    pinResetOtp: {
      type: String,
      default: "",
    },

    pinResetOtpExpiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const MasterModel = mongoose.model("Master", masterSchema);

module.exports = { MasterModel };