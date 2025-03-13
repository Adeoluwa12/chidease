declare global {
    namespace NodeJS {
      interface ProcessEnv {
        NODE_ENV: "development" | "production" | "test"
        PORT?: string
        MONGODB_URI: string
        AVAILITY_USERNAME: string
        AVAILITY_PASSWORD: string
        EMAIL_SECURE: string
        EMAIL_USER: string
        EMAIL_HOST: string
        EMAIL_PASS: string
        EMAIL_FROM: string
        EMAIL_RECIPIENTS: string
        TWILIO_ACCOUNT_SID: string
        TWILIO_AUTH_TOKEN: string
        TWILIO_PHONE_NUMBER: string
        SMS_RECIPIENTS: string
      }
    }
  }
  
  export {}
  
  