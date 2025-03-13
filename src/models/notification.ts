import mongoose, { type Document, Schema } from "mongoose"

export interface INotification extends Document {
  referralId: mongoose.Types.ObjectId
  memberName: string
  memberID: string
  message: string
  isRead: boolean
  createdAt: Date
}

const NotificationSchema = new Schema({
  referralId: {
    type: Schema.Types.ObjectId,
    ref: "Referral",
    required: true,
  },
  memberName: {
    type: String,
    required: true,
  },
  memberID: {
    type: String,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  isRead: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

export const Notification = mongoose.model<INotification>("Notification", NotificationSchema)

