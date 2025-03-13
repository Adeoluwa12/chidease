import mongoose, { type Document, Schema } from "mongoose"

export interface IMemberDetail {
  memberID: string
  dob: string
  address: string
  gender: string
  lang: string
  preferences: string
  requestOn: string
  respondBy: string
  referralNum: string
  memberFirstName: string
  yearOfBirth: string
  zipCode: string
}

export interface IRequestedInfo {
  contactName: string | null
  contactPhone: string | null
  additionalInfo: string | null
}

export interface IExtraInfo {
  diagnosis: string
  caseDesc: string
  taskSchedule: string
  memPhone: string
  careGiverPhoneNumber: string | null
  additionalInfo: string
  careGiverName: string | null
}

export interface IReferral extends Document {
  memberID: string
  memberName: string
  serviceName: string
  regionName: string
  memberFirstName: string
  requestOn: string
  county: string
  plan: string
  startDate: string | null
  preferredStartDate: string
  status: string
  providerStatus: string
  declinedReason: string | null
  memberDetail: IMemberDetail
  requestedInfo: IRequestedInfo
  extra: IExtraInfo
  isNotified: boolean
  createdAt: Date
}

const ReferralSchema = new Schema({
  memberID: String,
  memberName: String,
  serviceName: String,
  regionName: String,
  memberFirstName: String,
  requestOn: String,
  county: String,
  plan: String,
  startDate: String,
  preferredStartDate: String,
  status: String,
  providerStatus: String,
  declinedReason: String,
  memberDetail: {
    memberID: String,
    dob: String,
    address: String,
    gender: String,
    lang: String,
    preferences: String,
    requestOn: String,
    respondBy: String,
    referralNum: String,
    memberFirstName: String,
    yearOfBirth: String,
    zipCode: String,
  },
  requestedInfo: {
    contactName: String,
    contactPhone: String,
    additionalInfo: String,
  },
  extra: {
    diagnosis: String,
    caseDesc: String,
    taskSchedule: String,
    memPhone: String,
    careGiverPhoneNumber: String,
    additionalInfo: String,
    careGiverName: String,
  },
  isNotified: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
})

export const Referral = mongoose.model<IReferral>("Referral", ReferralSchema)

