import twilio from "twilio"
import { config } from "dotenv"

config()

const accountSid = process.env.TWILIO_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const fromNumber = process.env.TWILIO_PHONE_NUMBER
const toNumbers = process.env.SMS_RECIPIENTS?.split(",") || []

export async function sendSMS(message: string): Promise<void> {
  console.log("Preparing to send SMS notification...")
  console.log(`SMS message: ${message}`)
  try {
    if (!accountSid || !authToken || !fromNumber) {
      console.warn("Twilio credentials not configured in environment variables")
      return
    }

    if (toNumbers.length === 0) {
      console.warn("No SMS recipients configured in environment variables")
      return
    }

    console.log(`Sending SMS to ${toNumbers.length} recipients using Twilio`)
    console.log(`Using Twilio phone number: ${fromNumber}`)

    const client = twilio(accountSid, authToken)

    for (const toNumber of toNumbers) {
      console.log(`Sending SMS to recipient: ${toNumber}`)

      const result = await client.messages.create({
        body: message,
        from: fromNumber,
        to: toNumber.trim(),
      })

      console.log(`SMS sent successfully to ${toNumber}. Message SID: ${result.sid}`)
      console.log(`SMS status: ${result.status}`)
    }

    console.log("All SMS notifications sent successfully")
  } catch (error) {
    console.error("Error sending SMS notification:", error)
    throw error
  }
}

