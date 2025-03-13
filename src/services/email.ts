import nodemailer from "nodemailer";
import { config } from "dotenv";

config();

// Log SMTP config for debugging
console.log("SMTP Config Loaded:", {
  host: process.env.EMAIL_HOST || "smtp.sendgrid.net",
  port: Number.parseInt(process.env.EMAIL_PORT || "587", 10),
  secure: process.env.EMAIL_SECURE === "true",
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASS ? "[REDACTED]" : "undefined",
  recipients: process.env.EMAIL_RECIPIENTS,
});

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.sendgrid.net",
  port: Number.parseInt(process.env.EMAIL_PORT || "587", 10),
  secure: process.env.EMAIL_SECURE === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  debug: true, // Keep for now, remove or set to false in production
  logger: true,
  tls: {
    rejectUnauthorized: false, // Remove in production for stricter security
  },
});

// Verify transporter with retry
async function verifyTransporter(attempts = 3, delayMs = 5000) {
  for (let i = 0; i < attempts; i++) {
    try {
      console.log(`Attempting to verify SMTP connection (${i + 1}/${attempts})...`);
      await transporter.verify();
      console.log("SMTP transporter is ready to send emails.");
      return;
    } catch (error) {
      console.error(`Verify attempt ${i + 1}/${attempts} failed:`, error);
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

verifyTransporter();

export async function sendEmail(subject: string, text: string): Promise<void> {
  console.log("Preparing to send email notification...");
  console.log(`Email subject: ${subject}`);

  try {
    const recipients = process.env.EMAIL_RECIPIENTS?.split(",").map((r) => r.trim()) || [];

    if (recipients.length === 0) {
      console.warn("No email recipients configured in environment variables");
      return;
    }

    console.log(`Sending email to ${recipients.length} recipients: ${recipients.join(", ")}`);

    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || "adeoyeoluwaferanmi@gmail.com", // Must be a SendGrid-verified sender
      to: recipients.join(","),
      subject,
      text,
    });

    console.log(`Email sent successfully. Message ID: ${info.messageId}`);
  } catch (error) {
    console.error("Error sending email notification:", error);
    throw error;
  }
}

// Test email sending
(async () => {
  try {
    await sendEmail("Availity Referrals - Current Members", "This is the member information...");
    console.log("✅ Email with member information sent successfully");
  } catch (error) {
    console.error("❌ Error sending member information email:", error);
  }
})();