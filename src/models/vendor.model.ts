import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
  type Types,
} from "mongoose";

const CreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: ["MASTER", "MANAGER", "SHOP_OWNER", "SHOP_STAFF"],
      required: true,
    },
    id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const AddressSchema = new Schema(
  {
    state: {
      type: String,
      default: "",
      trim: true,
    },
    district: {
      type: String,
      default: "",
      trim: true,
    },
    taluk: {
      type: String,
      default: "",
      trim: true,
    },
    area: {
      type: String,
      default: "",
      trim: true,
    },
    street: {
      type: String,
      default: "",
      trim: true,
    },
    pincode: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const VendorSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    vendorName: {
      type: String,
      required: true,
      trim: true,
    },

    vendorKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },

    contactPerson: {
      type: String,
      default: "",
      trim: true,
    },

    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },

    mobile: {
      type: String,
      default: "",
      trim: true,
    },

    gstNumber: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },

    gstState: {
      type: String,
      default: "",
      trim: true,
    },

    address: {
      type: AddressSchema,
      default: () => ({}),
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "ACTIVE",
      index: true,
    },

    createdBy: {
      type: CreatedBySchema,
      required: true,
    },
  },
  { timestamps: true }
);

/**
 * One shop cannot have duplicate vendor code.
 * Example:
 * Shop A -> NANSUP8792 allowed once
 * Shop B -> NANSUP8792 allowed separately
 */
VendorSchema.index({ shopId: 1, code: 1 }, { unique: true });

/**
 * One shop cannot have duplicate vendor name.
 */
VendorSchema.index({ shopId: 1, vendorKey: 1 }, { unique: true });

/**
 * Optional search indexes
 */
VendorSchema.index({ shopId: 1, status: 1 });
VendorSchema.index({ shopId: 1, mobile: 1 });
VendorSchema.index({ shopId: 1, gstNumber: 1 });
VendorSchema.index({ shopId: 1, gstState: 1 });

/**
 * Address search indexes
 */
VendorSchema.index({ shopId: 1, "address.state": 1 });
VendorSchema.index({ shopId: 1, "address.district": 1 });
VendorSchema.index({ shopId: 1, "address.pincode": 1 });

export type Vendor = InferSchemaType<typeof VendorSchema>;

export type VendorDocument = HydratedDocument<Vendor> & {
  _id: Types.ObjectId;
};

export const VendorModel =
  models.Vendor || model<Vendor>("Vendor", VendorSchema);