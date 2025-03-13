import mongoose, { type Document, Schema } from "mongoose"

export interface IBackupCode extends Document {
  code: string
  isUsed: boolean
  createdAt: Date
}

const BackupCodeSchema = new Schema({
  code: {
    type: String,
    required: true,
    unique: true,
  },
  isUsed: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

export const BackupCode = mongoose.model<IBackupCode>("BackupCode", BackupCodeSchema)

