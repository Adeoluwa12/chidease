import puppeteer, { type Browser, type Page } from "puppeteer"
import axios, { type AxiosError } from "axios"
import { authenticator } from "otplib"
import { config } from "dotenv"
import { sendEmail } from "./email"
import { sendSMS } from "./sms"
import { Referral } from "../models/referrals"
import { Notification } from "../models/notification"




config()

// Fix the type error by making page nullable
let browser: Browser | null = null
let page: Page | null = null
let lastCheckTime = new Date()

const AVAILITY_URL = "https://apps.availity.com"
const LOGIN_URL = "https://apps.availity.com/availity/web/public.elegant.login"
const REFERRALS_API_URL = "https://apps.availity.com/api/v1/proxy/anthem/provconn/v1/carecentral/ltss/referral/details"

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome-stable";

interface ReferralResponse {
  effectiveDate: string
  referrals: Array<{
    memberName: string
    memberID: string
    serviceName: string
    regionName: string
    county: string
    plan: string
    preferredStartDate: string
    status: string
    requestOn: string
  }>
}

// Member interface for data extracted from the page
interface MemberData {
  memberName: string
  memberID: string
  serviceName?: string
  status?: string
  requestDate?: string
  additionalInfo?: string
}

// Helper function for timeouts - reduced delay times
async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Retry operation helper - reduced delay time
async function retryOperation(operation: () => Promise<void>, retries = 3, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      await operation()
      return
    } catch (error) {
      console.log(`Attempt ${i + 1} failed:`, error)
      if (i < retries - 1) {
        console.log(`Retrying in ${delayMs}ms...`)
        await delay(delayMs)
      } else {
        throw error
      }
    }
  }
}

export async function getSessionCookies(): Promise<string> {
  if (!page) {
    throw new Error("Page not initialized")
  }

  const cookies = await page.cookies()
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
    page = null
    console.log("Browser closed successfully")
  } else {
    console.log("No browser instance to close")
  }
}

export async function setupBot(): Promise<void> {
  try {
    browser = await puppeteer.launch({
        executablePath,
      headless: "new" as any,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1280,800",
      ],
      defaultViewport: { width: 1280, height: 800 },
      timeout: 60000, // Reduced timeout
    })

    console.log("✅ Browser launched successfully")

    // Create a new page
    page = await browser.newPage()

    // Set viewport size
    await page.setViewport({ width: 1280, height: 800 })

    // Add additional configurations - reduced timeouts
    await page.setDefaultNavigationTimeout(60000)
    await page.setDefaultTimeout(60000)

    // Enable console logging from the browser
    page.on("console", (msg) => console.log("Browser console:", msg.text()))

    // Log network requests for debugging
    page.on("request", (request) => console.log("Request:", request.method(), request.url()))
    page.on("response", (response) => console.log("Response:", response.status(), response.url()))

    console.log("✅ Bot setup completed with enhanced configuration")
  } catch (error) {
    console.error("❌ Error setting up bot:", error)
    throw error
  }
}

async function handlePopups(page: Page): Promise<void> {
  console.log("🔍 Checking for popups to dismiss...")
  try {
    const closeButtonSelectors = [
      'button:has-text("×")',
      "button.close",
      'button[aria-label="Close"]',
      ".modal-close",
      ".dialog-close",
      ".modal-header button",
      'button:has-text("Close")',
      'button:has-text("Cancel")',
      'button:has-text("Dismiss")',
    ]

    for (const selector of closeButtonSelectors) {
      try {
        const closeButtons = await page.$$(selector)
        for (const button of closeButtons) {
          const isVisible = await button.evaluate((el) => {
            const style = window.getComputedStyle(el)
            return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
          })

          if (isVisible) {
            console.log(`✅ Found visible close button with selector: ${selector}. Clicking...`)
            await button.click()
            await delay(500) // Reduced delay
          }
        }
      } catch (error) {
        console.log(`⚠️ No close button found with selector ${selector}:`, error)
      }
    }

    const modalSelectors = [".modal.show", ".dialog.show", '[role="dialog"]', '[aria-modal="true"]']

    for (const selector of modalSelectors) {
      try {
        const modals = await page.$$(selector)
        for (const modal of modals) {
          const closeButton = await modal.$('button:has-text("×"), button.close, button[aria-label="Close"]')
          if (closeButton) {
            console.log(`✅ Found close button in modal. Clicking...`)
            await closeButton.click()
            await delay(500) // Reduced delay
          }
        }
      } catch (error) {
        console.log(`⚠️ Error handling modal with selector ${selector}:`, error)
      }
    }

    console.log("✅ Finished checking for popups")
  } catch (error) {
    console.error("❌ Error handling popups:", error)
    await page.screenshot({ path: `popup-error-${Date.now()}.png` })
  }
}

export async function loginToAvaility(): Promise<boolean> {
  console.log("🔑 Starting Availity login process...")

  try {
    if (!browser || !page) {
      console.log("🔄 Browser or page not initialized. Setting up bot...")
      await setupBot()
    }

    if (!page) {
      console.error("❌ Browser page not initialized after setup attempt")
      throw new Error("Browser page not initialized")
    }

    console.log("🌐 Navigating to Availity login page...")
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2" })
    console.log("✅ Login page loaded successfully")

    // Enter username and password
    console.log("👤 Entering username and password...")
    await page.type("#userId", process.env.AVAILITY_USERNAME || "")
    await page.type("#password", process.env.AVAILITY_PASSWORD || "")

    // Click login button and handle navigation differently
    console.log("🔐 Submitting login credentials...")
    await page.click('button[type="submit"]')

    // Wait for either navigation to complete or for 2FA form to appear
    try {
      console.log("⏳ Waiting for post-login page to load...")
      await Promise.race([
        page.waitForNavigation({ timeout: 60000 }),
        page.waitForSelector('form[name="backupCodeForm"]', { timeout: 60000 }),
        page.waitForSelector('form[name="authenticatorCodeForm"]', { timeout: 60000 }),
        page.waitForSelector(".top-applications", { timeout: 60000 }), // Dashboard element
      ])
      console.log("✅ Post-login navigation completed")
    } catch (navError) {
      console.log("⚠️ Navigation timeout or selector not found. Checking login status...")
    }

    // Check if we're logged in by looking for dashboard elements
    const isLoggedIn = await page.evaluate(() => {
      const dashboardElements =
        document.querySelector(".top-applications") !== null ||
        document.querySelector(".av-dashboard") !== null ||
        document.querySelector(".dashboard-container") !== null

      const cookieConsent = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).some((h) =>
        h.textContent?.includes("Cookie Consent & Preferences"),
      )

      return dashboardElements || cookieConsent
    })

    // Check if we need to handle 2FA
    console.log("🔍 Checking if 2FA authentication is required...")
    const is2FARequired = await page.evaluate(() => {
      return (
        document.querySelector('form[name="backupCodeForm"]') !== null ||
        document.querySelector('form[name="authenticatorCodeForm"]') !== null ||
        document.querySelector('input[type="radio"][value*="authenticator"]') !== null ||
        document.querySelector('input[type="radio"][value*="backup"]') !== null
      )
    })

    if (is2FARequired) {
      console.log("🔒 2FA authentication is required. Handling 2FA...")
      await handle2FA(page)
    } else if (isLoggedIn) {
      console.log("✅ Already logged in - no 2FA required")
    } else {
      console.log("⚠️ Login status unclear. Taking screenshot for debugging...")
      await page.screenshot({ path: `login-status-${Date.now()}.png` })
      console.log("🔍 Checking URL to determine login status...")
      const currentUrl = page.url()
      console.log(`📍 Current URL: ${currentUrl}`)

      if (currentUrl.includes("login") || currentUrl.includes("authenticate")) {
        console.log("❌ Still on login page. Login may have failed.")
        throw new Error("Login failed - still on login page")
      } else {
        console.log("✅ URL indicates we may be logged in")
      }
    }

    // Handle any cookie consent popup that might appear after login
    await handleCookieConsent(page)

    // Handle any other popups that might appear
    await handlePopups(page)

    // Navigate to Care Central
    console.log("🏥 Proceeding to navigate to Care Central...")
    await navigateToCareCentral(page)

    console.log("✅ Login process completed successfully")
    return true
  } catch (error) {
    console.error("❌ Error during login attempt:", error)
    throw error
  }
}

async function handle2FA(page: Page): Promise<void> {
  console.log("🔐 Starting Availity 2FA authentication process with authenticator app...")
  try {
    // Wait for the 2FA options to be visible
    console.log("⏳ Waiting for Availity 2FA options to load...")
    await page.waitForSelector('input[type="radio"]', { visible: true, timeout: 30000 })

    // Take a screenshot for debugging
    await page.screenshot({ path: `2fa-options-${Date.now()}.png` })
    console.log("📸 Took screenshot of Availity 2FA options page")

    // Find and click the "Authenticate me using my Authenticator app" radio button
    console.log("🔍 Selecting 'Authenticate me using my Authenticator app' option...")

    let authenticatorOptionSelected = false

    // Approach 1: Try direct selector for the authenticator app radio button
    try {
      const authenticatorRadioSelector =
        'input[type="radio"][value*="authenticator"], input[type="radio"][id*="authenticator"], input[type="radio"][name*="authenticator"]'
      const authenticatorRadio = await page.$(authenticatorRadioSelector)

      if (authenticatorRadio) {
        await authenticatorRadio.click()
        console.log("✅ Selected authenticator app option using direct selector")
        authenticatorOptionSelected = true
      }
    } catch (error) {
      console.log("⚠️ Could not select authenticator app option using direct selector:", error)
    }

    // Approach 2: Try finding by label text if approach 1 failed
    if (!authenticatorOptionSelected) {
      try {
        const labels = await page.$$("label")
        for (const label of labels) {
          const text = await label.evaluate((el) => el.textContent)
          if (text && text.toLowerCase().includes("authenticator app")) {
            console.log("🔍 Found authenticator app option by label text:", text)
            await label.click()
            console.log("✅ Clicked on authenticator app label")
            authenticatorOptionSelected = true
            break
          }
        }
      } catch (error) {
        console.log("⚠️ Could not select authenticator app option by label text:", error)
      }
    }

    // Approach 3: Try selecting the first radio button (assuming it's the authenticator app option)
    if (!authenticatorOptionSelected) {
      try {
        const radioButtons = await page.$$('input[type="radio"]')
        if (radioButtons.length >= 1) {
          await radioButtons[0].click()
          console.log("✅ Selected first radio button (assuming it's the authenticator app option)")
          authenticatorOptionSelected = true
        }
      } catch (error) {
        console.log("⚠️ Could not select first radio button:", error)
      }
    }

    if (!authenticatorOptionSelected) {
      throw new Error("Could not select authenticator app option using any method")
    }

    // Take another screenshot to verify selection
    await page.screenshot({ path: `2fa-selected-${Date.now()}.png` })
    console.log("📸 Took screenshot after selecting authenticator app option")

    // Click the Continue button
    console.log("🔍 Looking for the blue 'Continue' button...")
    const continueButton = await page.$('button[type="submit"]')
    if (!continueButton) {
      throw new Error("Continue button not found")
    }
    await continueButton.click()
    console.log("✅ Clicked Continue button")

    // Wait for the OTP input form to load
    console.log("⏳ Waiting for authenticator code input form after clicking Continue...")
    await page.waitForSelector('input[name="code"], input[name="authenticatorCode"], input[type="text"]', {
      visible: true,
      timeout: 30000,
    })
    console.log("✅ Authenticator code input form appeared")

    // Use the hardcoded secret to generate the TOTP code
    const secret = "RU4SZCAW4UESMUQNCG3MXTWKXA"
    console.log(`🔑 Using hardcoded TOTP secret: ${secret.substring(0, 3)}...${secret.substring(secret.length - 3)}`)

    // Generate the TOTP code
    console.log("🔢 Generating TOTP code...")
    const totpCode = authenticator.generate(secret)
    console.log(`✅ Generated TOTP code: ${totpCode}`)

    // Enter the TOTP code
    console.log("⌨️ Entering TOTP code into the form...")
    const codeInputSelectors = ['input[name="code"]', 'input[name="authenticatorCode"]', 'input[type="text"]']

    let codeEntered = false

    for (const selector of codeInputSelectors) {
      try {
        const codeInput = await page.$(selector)
        if (codeInput) {
          await codeInput.type(totpCode)
          console.log(`✅ Entered TOTP code using selector: ${selector}`)
          codeEntered = true
          break
        }
      } catch (error) {
        console.log(`⚠️ Could not enter TOTP code with selector ${selector}:`, error)
      }
    }

    if (!codeEntered) {
      throw new Error("Could not enter TOTP code")
    }

    // Take a screenshot after filling the code
    await page.screenshot({ path: `2fa-code-filled-${Date.now()}.png` })
    console.log("📸 Took screenshot after filling the TOTP code")

    // Click submit button
    console.log("🔐 Submitting the TOTP code...")
    const submitButtonSelectors = [
      'button[type="submit"]',
      'button:has-text("Continue")',
      'button:has-text("Submit")',
      'button:has-text("Verify")',
      "button.btn-primary",
    ]

    let submitButtonClicked = false

    for (const selector of submitButtonSelectors) {
      try {
        const submitButton = await page.$(selector)
        if (submitButton) {
          console.log(`✅ Found submit button using selector: ${selector}`)
          await Promise.all([
            submitButton.click(),
            page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch((e) => {
              console.log("⚠️ Navigation timeout after submitting code, but this might be expected")
            }),
          ])
          console.log("✅ Clicked submit button")
          submitButtonClicked = true
          break
        }
      } catch (error) {
        console.log(`⚠️ Could not click submit button with selector ${selector}:`, error)
      }
    }

    if (!submitButtonClicked) {
      throw new Error("Could not find or click submit button")
    }

    console.log("⏳ Waiting for post-2FA page to load...")
    try {
      await Promise.race([
        page.waitForSelector(".top-applications, .av-dashboard, .dashboard-container", {
          timeout: 30000,
          visible: true,
        }),
        page.waitForFunction(
          () => {
            const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"))
            return headings.some((h) => h.textContent?.includes("Cookie Consent & Preferences"))
          },
          { timeout: 30000 },
        ),
        page.waitForSelector(".alert-danger, .error-message", {
          timeout: 30000,
          visible: true,
        }),
      ])

      const errorMessage = await page.$(".alert-danger, .error-message")
      if (errorMessage) {
        const text = await page.evaluate((el) => el.textContent, errorMessage)
        throw new Error(`2FA resulted in error: ${text}`)
      }

      await page.screenshot({ path: `post-2fa-${Date.now()}.png` })
      console.log("✅ Post-2FA navigation completed")

      await delay(2000) // Reduced delay
    } catch (error) {
      console.log("⚠️ Navigation timeout after 2FA, but this might be expected. Continuing...")
      await page.screenshot({ path: `post-2fa-timeout-${Date.now()}.png` })
    }

    const isLoggedIn = await page.evaluate(() => {
      const dashboardElements =
        document.querySelector(".top-applications") !== null ||
        document.querySelector(".av-dashboard") !== null ||
        document.querySelector(".dashboard-container") !== null

      const cookieConsent = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).some((h) =>
        h.textContent?.includes("Cookie Consent & Preferences"),
      )

      return dashboardElements || cookieConsent
    })

    if (!isLoggedIn) {
      console.error("❌ 2FA may have failed - no dashboard elements found")
      await page.screenshot({ path: `2fa-verification-failed-${Date.now()}.png` })
      throw new Error("2FA verification failed - no dashboard elements found")
    }

    console.log("✅ 2FA verification successful - dashboard elements found")

    console.log("✅ 2FA authentication process completed successfully")
  } catch (error) {
    console.error("❌ Error handling 2FA:", error)
    await page.screenshot({ path: `2fa-error-${Date.now()}.png` })
    throw error
  }
}

async function handleCookieConsent(page: Page): Promise<void> {
  console.log("🍪 Checking for cookie consent popup...")
  try {
    await page
      .waitForFunction(
        () => {
          const heading = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).find((el) =>
            el.textContent?.includes("Cookie Consent & Preferences"),
          )
          const acceptButton = document.querySelector('button.primary-button, button:has-text("Accept All Cookies")')
          return heading && acceptButton
        },
        { timeout: 5000 },
      )
      .catch(() => console.log("No cookie consent popup found within timeout"))

    await page.screenshot({ path: `cookie-consent-before-${Date.now()}.png` })

    const acceptButtonSelector = 'button.primary-button, button:has-text("Accept All Cookies")'
    let accepted = false

    try {
      const acceptButton = await page.$(acceptButtonSelector)
      if (acceptButton) {
        console.log("✅ Found Accept All Cookies button. Clicking...")
        await acceptButton.click()
        await delay(1000) // Reduced delay
        accepted = true
      }
    } catch (error) {
      console.log("⚠️ Could not click Accept All Cookies button directly:", error)
    }

    if (!accepted) {
      console.log("🔄 Trying alternative method to find Accept All Cookies button...")
      try {
        accepted = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"))
          const acceptButton = buttons.find((button) =>
            button.textContent?.toLowerCase().includes("accept all cookies"),
          )
          if (acceptButton) {
            acceptButton.click()
            return true
          }
          return false
        })
        if (accepted) {
          console.log("✅ Clicked Accept All Cookies button via evaluate")
          await delay(1000) // Reduced delay
        }
      } catch (error) {
        console.log("⚠️ Could not click Accept All Cookies button via evaluate:", error)
      }
    }

    if (!accepted) {
      console.log("🔄 Trying to click Accept All Cookies button at specific coordinates...")
      try {
        await page.mouse.click(636, 636)
        accepted = true
        await delay(1000) // Reduced delay
        console.log("✅ Clicked at Accept All Cookies button coordinates")
      } catch (error) {
        console.log("⚠️ Could not click at Accept All Cookies coordinates:", error)
      }
    }

    const popupGone = await page.evaluate(() => {
      return !document.querySelector('h2:has-text("Cookie Consent & Preferences")')
    })

    if (popupGone) {
      console.log("✅ Cookie consent popup successfully handled")
    } else {
      console.log("⚠️ Cookie consent popup might still be present")
      await page.screenshot({ path: `cookie-consent-after-${Date.now()}.png` })
    }
  } catch (error) {
    console.error("❌ Error handling cookie consent:", error)
    await page.screenshot({ path: `cookie-consent-error-${Date.now()}.png` })
  }
}

async function navigateToCareCentral(page: Page): Promise<void> {
  console.log("🏥 Starting navigation to Care Central...")
  try {
    // Wait for the dashboard to load
    console.log("⏳ Waiting for dashboard to load...")
    await page.waitForSelector("body", { timeout: 60000, visible: true })

    // Take a screenshot of the dashboard
    await page.screenshot({ path: `dashboard-${Date.now()}.png` })
    console.log("📸 Took screenshot of the dashboard")

    // Wait for a bit to ensure the page is fully loaded
    await delay(2000) // Reduced delay

    // Take another screenshot after delay
    await page.screenshot({ path: `dashboard-after-delay-${Date.now()}.png` })

    // Look for "My Top Applications" heading first
    console.log("🔍 Looking for 'My Top Applications' heading...")
    const myTopAppsHeadingSelectors = [
      'h1:has-text("My Top Applications")',
      'h2:has-text("My Top Applications")',
      'h3:has-text("My Top Applications")',
      'h4:has-text("My Top Applications")',
      'div:has-text("My Top Applications")',
      'span:has-text("My Top Applications")',
    ]

    let myTopAppsHeading = null
    for (const selector of myTopAppsHeadingSelectors) {
      try {
        myTopAppsHeading = await page.$(selector)
        if (myTopAppsHeading) {
          console.log(`✅ Found 'My Top Applications' heading using selector: ${selector}`)
          break
        }
      } catch (error) {
        console.log(`⚠️ Could not find 'My Top Applications' heading with selector: ${selector}`)
      }
    }

    // Now try to find Care Central by searching for all elements containing that text
    console.log("🔍 Searching for all elements containing 'Care Central' text...")

    // Use page.evaluate to find all elements with "Care Central" text
    const careCentralElements = await page.evaluate(() => {
      const allElements = Array.from(document.querySelectorAll("*"))
      return allElements
        .filter((el) => {
          const text = el.textContent || ""
          return text.includes("Care Central") && !text.includes("Care Central.")
        })
        .map((el) => {
          const rect = el.getBoundingClientRect()
          return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            width: rect.width,
            height: rect.height,
            text: el.textContent,
            tagName: el.tagName,
            className: el.className,
            id: el.id,
          }
        })
    })

    console.log(`Found ${careCentralElements.length} elements containing "Care Central" text`)
    console.log("Elements found:", JSON.stringify(careCentralElements, null, 2))

    // Take a screenshot before clicking
    await page.screenshot({ path: `before-click-care-central-${Date.now()}.png` })

    // Try to click the most likely element (filter for reasonable size and position)
    let clicked = false
    for (const element of careCentralElements) {
      // Look for elements that are likely to be clickable tiles (reasonable size)
      if (element.width > 50 && element.height > 50) {
        console.log(`Attempting to click element: ${JSON.stringify(element)}`)
        try {
          await page.mouse.click(element.x, element.y)
          console.log(`✅ Clicked element at coordinates: x=${element.x}, y=${element.y}`)
          clicked = true

          // Wait a bit to see if navigation happens
          await delay(3000) // Reduced delay

          // Check if we've navigated away from the dashboard
          const currentUrl = page.url()
          console.log(`Current URL after click: ${currentUrl}`)

          if (currentUrl.includes("care-central") || !currentUrl.includes("dashboard")) {
            console.log("✅ Successfully navigated away from dashboard")
            break
          } else {
            console.log("⚠️ Still on dashboard page after click, trying next element")
            clicked = false
          }
        } catch (error) {
          console.log(`⚠️ Error clicking element: ${error}`)
        }
      }
    }

    // If we still haven't clicked successfully, try a different approach
    if (!clicked) {
      console.log("🔍 Trying alternative approach - looking for Wellpoint image...")

      // Try to find the Wellpoint image
      const wellpointImages = await page.evaluate(() => {
        const images = Array.from(document.querySelectorAll("img"))
        return images
          .filter((img) => {
            const src = img.src || ""
            const alt = img.alt || ""
            return (
              src.includes("wellpoint") ||
              alt.includes("Wellpoint") ||
              src.includes("Wellpoint") ||
              alt.includes("wellpoint")
            )
          })
          .map((img) => {
            const rect = img.getBoundingClientRect()
            return {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              width: rect.width,
              height: rect.height,
              src: img.src,
              alt: img.alt,
            }
          })
      })

      console.log(`Found ${wellpointImages.length} Wellpoint images`)
      console.log("Wellpoint images:", JSON.stringify(wellpointImages, null, 2))

      // Try clicking on a Wellpoint image
      for (const img of wellpointImages) {
        try {
          await page.mouse.click(img.x, img.y)
          console.log(`✅ Clicked Wellpoint image at coordinates: x=${img.x}, y=${img.y}`)
          clicked = true
          await delay(3000) // Reduced delay
          break
        } catch (error) {
          console.log(`⚠️ Error clicking Wellpoint image: ${error}`)
        }
      }
    }

    // Last resort - try clicking at fixed coordinates where Care Central is likely to be
    if (!clicked) {
      console.log("🔍 Last resort - clicking at fixed coordinates...")

      // Try a few different positions where Care Central might be
      const potentialPositions = [
        { x: 240, y: 400 }, // Based on your screenshot
        { x: 240, y: 430 },
        { x: 270, y: 400 },
        { x: 200, y: 400 },
      ]

      for (const pos of potentialPositions) {
        try {
          await page.mouse.click(pos.x, pos.y)
          console.log(`✅ Clicked at fixed coordinates: x=${pos.x}, y=${pos.y}`)
          await delay(3000) // Reduced delay

          // Check if we've navigated away
          const currentUrl = page.url()
          if (currentUrl.includes("care-central") || !currentUrl.includes("dashboard")) {
            console.log("✅ Successfully navigated away from dashboard")
            clicked = true
            break
          }
        } catch (error) {
          console.log(`⚠️ Error clicking at fixed coordinates: ${error}`)
        }
      }
    }

    if (!clicked) {
      throw new Error("Failed to click on Care Central after trying multiple approaches")
    }

    // Wait for the iframe to load
    console.log("⏳ Waiting for iframe to load...")
    await page.waitForSelector("#newBodyFrame", { timeout: 30000 })

    // Take a screenshot before switching to iframe
    await page.screenshot({ path: `before-iframe-switch-${Date.now()}.png` })
    console.log("📸 Took screenshot before switching to iframe")

    // Get all frames and find the one with name="newBody"
    const frames = page.frames()
    const newBodyFrame = frames.find((frame) => frame.name() === "newBody")

    if (!newBodyFrame) {
      console.log("❌ Could not find newBody iframe")
      throw new Error("Could not find newBody iframe")
    }

    console.log("✅ Found newBody iframe")

    // Wait for the form to load in the iframe
    console.log("⏳ Waiting for form to load in iframe...")
    await newBodyFrame.waitForSelector("form", { timeout: 30000 })
    console.log("✅ Form loaded in iframe")

    // Wait for the organization dropdown to be present in the iframe
    console.log("⏳ Waiting for organization dropdown in iframe...")
    await newBodyFrame.waitForSelector("#organizations", { timeout: 30000 })
    console.log("✅ Found organization dropdown in iframe")

    // Take a screenshot after finding the organization dropdown
    await page.screenshot({ path: `found-organization-dropdown-${Date.now()}.png` })

    // Click on the organization dropdown
    console.log("🖱️ Clicking on organization dropdown...")
    await newBodyFrame.click("#organizations")
    await delay(1000)

    // Type the organization name
    console.log("⌨️ Typing organization name...")
    await newBodyFrame.click("#organizations")
    await delay(1000)

    // Wait for and click the option
    console.log("⏳ Waiting for organization option...")
    await newBodyFrame.waitForSelector(".av-select", { visible: true, timeout: 60000 })
    await newBodyFrame.click(".av-select")
    console.log("✅ Selecting organization")

    // Look specifically for Harmony Health LLC option
    console.log("🔍 Looking for 'Harmony Health LLC' option...")
    const harmonyOption = await newBodyFrame.evaluate(() => {
      const options = Array.from(document.querySelectorAll(".av__option"))
      const harmonyOption = options.find(
        (option) => option.textContent && option.textContent.includes("Harmony Health LLC"),
      )
      return harmonyOption ? true : false
    })

    if (harmonyOption) {
      // Click on the Harmony Health LLC option
      await newBodyFrame.evaluate(() => {
        const options = Array.from(document.querySelectorAll(".av__option"))
        const harmonyOption = options.find(
          (option) => option.textContent && option.textContent.includes("Harmony Health LLC"),
        )
        if (harmonyOption) {
          ;(harmonyOption as HTMLElement).click()
        }
      })
      console.log("✅ Selected 'Harmony Health LLC' organization")
    } else {
      // If Harmony Health LLC not found, click the first option
      console.log("⚠️ 'Harmony Health LLC' not found, selecting first available option...")
      await newBodyFrame.click(".av__option")
      console.log("✅ Selected first organization option")
    }

    // Wait for provider field to become enabled
    console.log("⏳ Waiting for provider field to become enabled...")
    // Click and select provider
    console.log("🖱️ Clicking provider dropdown...")
    await newBodyFrame.click("#providerName")
    await delay(1000)

    // Wait for dropdown options to appear
    console.log("⏳ Waiting for provider options to appear...")
    await newBodyFrame.waitForSelector(".av__option", { visible: true, timeout: 10000 })

    // Take a screenshot of the provider options
    await page.screenshot({ path: `provider-options-${Date.now()}.png` })

    // Look specifically for Harmony Health provider option
    console.log("🔍 Looking for 'Harmony Health' provider option...")
    const harmonyProviderOption = await newBodyFrame.evaluate(() => {
      const options = Array.from(document.querySelectorAll(".av__option"))
      const harmonyOption = options.find(
        (option) =>
          option.textContent &&
          (option.textContent.includes("Harmony Health") || option.textContent.includes("HARMONY HEALTH")),
      )
      return harmonyOption ? true : false
    })

    if (harmonyProviderOption) {
      // Click on the Harmony Health provider option
      await newBodyFrame.evaluate(() => {
        const options = Array.from(document.querySelectorAll(".av__option"))
        const harmonyOption = options.find(
          (option) =>
            option.textContent &&
            (option.textContent.includes("Harmony Health") || option.textContent.includes("HARMONY HEALTH")),
        )
        if (harmonyOption) {
          ;(harmonyOption as HTMLElement).click()
        }
      })
      console.log("✅ Selected 'Harmony Health' provider")
    } else {
      // If Harmony Health not found, click the first option
      console.log("⚠️ 'Harmony Health' provider not found, selecting first available option...")
      await newBodyFrame.click(".av__option")
      console.log("✅ Selected first provider option")
    }

    // Wait for selection to be processed
    await delay(1000)

    // Take a screenshot after selecting provider
    await page.screenshot({ path: `after-provider-selection-${Date.now()}.png` })

    // Click the Next button
    console.log("👆 Clicking Next button...")
    await newBodyFrame.click("button.btn.btn-primary")

    // Wait for navigation
    console.log("⏳ Waiting for navigation after clicking Next...")
    await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }).catch(() => {
      console.log("Navigation timeout after Next, but this might be expected")
    })

    console.log("✅ Successfully completed organization and provider selection")

    // Take a screenshot after navigation
    await page.screenshot({ path: `after-next-button-${Date.now()}.png` })

    // Now we need to click on the Referrals button inside the iframe
    console.log("🔍 Looking for Referrals button inside iframe...")

    // Get the updated frames after navigation
    const updatedFrames = page.frames()
    const currentFrame = updatedFrames.find((frame) => frame.name() === "newBody")

    if (!currentFrame) {
      console.log("❌ Could not find newBody iframe after navigation")
      throw new Error("Could not find newBody iframe after navigation")
    }

    // Take a screenshot of the current state
    await page.screenshot({ path: `before-referrals-click-${Date.now()}.png` })

    // Look for the Referrals button with data-id="referral"
    console.log("🔍 Looking for button with data-id='referral'...")

    try {
      // Wait for the button to be visible
      await currentFrame.waitForSelector('button[data-id="referral"]', { visible: true, timeout: 10000 })
      console.log("✅ Found Referrals button")

      // Click the Referrals button
      await currentFrame.click('button[data-id="referral"]')
      console.log("✅ Clicked Referrals button")

      // Wait for the page to update after clicking
      await delay(3000)

      // Take a screenshot after clicking
      await page.screenshot({ path: `after-referrals-click-${Date.now()}.png` })
    } catch (error) {
      console.log("❌ Error finding or clicking Referrals button:", error)

      // Try alternative approach - evaluate and click directly in the frame
      console.log("🔍 Trying alternative approach - clicking button directly in frame...")

      try {
        const clicked = await currentFrame.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"))
          const referralButton = buttons.find(
            (button) => button.textContent && button.textContent.includes("Referrals"),
          )
          if (referralButton) {
            ;(referralButton as HTMLElement).click()
            return true
          }
          return false
        })

        if (clicked) {
          console.log("✅ Clicked Referrals button via evaluate")

          // Wait for the page to update
          await delay(3000)

          // Take a screenshot after clicking
          await page.screenshot({ path: `after-referrals-click-evaluate-${Date.now()}.png` })
        } else {
          throw new Error("Could not find Referrals button by text")
        }
      } catch (altError) {
        console.log("❌ Error with alternative approach:", altError)
        throw new Error("Failed to click Referrals button using any method")
      }
    }

    console.log("✅ Successfully navigated to Referrals page")

    // Now extract member information from the referrals page
    await extractMemberInformation(currentFrame)
  } catch (error) {
    console.error("❌ Error navigating to Care Central:", error)
    await page.screenshot({ path: `error-${Date.now()}.png` })
    throw error
  }
}

// New function to extract member information from the referrals page
async function extractMemberInformation(frame: any): Promise<MemberData[]> {
  console.log("🔍 Extracting member information from referrals page...")

  try {
    // Wait for the referrals content to load - using the specific class from the page
    console.log("⏳ Waiting for referrals content to load...")
    await frame.waitForSelector(".incoming-referral-info", { timeout: 15000 })

    // Take a screenshot of the referrals page
    if (page) {
      await page.screenshot({ path: `referrals-page-${Date.now()}.png` })
    }

    // Extract member information from the custom div structure
    const members = await frame.evaluate(() => {
      const results: Array<{
        memberName: string
        memberID: string
        serviceName: string
        status: string
        requestDate: string
        additionalInfo: string
      }> = []

      // Find all referral info containers
      const referralContainers = document.querySelectorAll(".incoming-referral-info")

      if (referralContainers.length === 0) {
        console.log("No referral containers found on the page")
        return results
      }

      // Process each referral container
      referralContainers.forEach((container) => {
        try {
          // Extract member name
          const memberNameElement = container.querySelector(".memName")
          const memberName =
            memberNameElement && memberNameElement.textContent ? memberNameElement.textContent.trim() : "Unknown"

          // Extract service
          const serviceElement = container.querySelector(".serviceCol")
          const serviceName = serviceElement && serviceElement.textContent ? serviceElement.textContent.trim() : ""

          // Extract region
          const regionElement = container.querySelector(".regionCol")
          const region = regionElement && regionElement.textContent ? regionElement.textContent.trim() : ""

          // Extract county
          const countyElement = container.querySelector(".countyCol")
          const county = countyElement && countyElement.textContent ? countyElement.textContent.trim() : ""

          // Extract program
          const programElement = container.querySelector(".programCol")
          const program = programElement && programElement.textContent ? programElement.textContent.trim() : ""

          // Extract status
          const statusElement = container.querySelector(".statusCol .badge")
          const status = statusElement && statusElement.textContent ? statusElement.textContent.trim() : ""

          // Extract referral number from more details section
          const moreDetailsSection = container.querySelector(".more-detail-section")
          let referralNumber = ""
          let requestDate = ""
          let yearOfBirth = ""
          let zipCode = ""

          if (moreDetailsSection) {
            // Find all detail rows
            const detailRows = moreDetailsSection.querySelectorAll(".d-flex")

            detailRows.forEach((row) => {
              // Look for Referral # field
              const headers = row.querySelectorAll(".moreDetailsHeader")
              const data = row.querySelectorAll(".moreDetailsData")

              for (let i = 0; i < headers.length; i++) {
                const headerElement = headers[i]
                const dataElement = i < data.length ? data[i] : null

                const headerText = headerElement && headerElement.textContent ? headerElement.textContent.trim() : ""
                const dataText = dataElement && dataElement.textContent ? dataElement.textContent.trim() : ""

                if (headerText.includes("Referral #")) {
                  referralNumber = dataText
                }

                if (headerText.includes("Requested On")) {
                  requestDate = dataText
                }

                if (headerText.includes("Year of Birth")) {
                  yearOfBirth = dataText
                }

                if (headerText.includes("Zip Code")) {
                  zipCode = dataText
                }
              }
            })
          }

          // Create member data object
          const memberData = {
            memberName,
            memberID: referralNumber || `unknown-${Date.now()}`, // Using referral number as member ID, with fallback
            serviceName,
            status,
            requestDate,
            additionalInfo: `Region: ${region}, County: ${county}, Program: ${program}, YOB: ${yearOfBirth}, Zip: ${zipCode}`,
          }

          results.push(memberData)
        } catch (err) {
          console.log("Error processing referral container:", err)
        }
      })

      return results
    })

    console.log(`✅ Extracted information for ${members.length} members`)
    console.log("Members found:", JSON.stringify(members, null, 2))

    // Send email with the extracted member information
    if (members.length > 0) {
      await sendMemberInformationEmail(members)
    } else {
      console.log("No members found to send in email")
    }

    // Save members to database
    await saveMembersToDatabase(members)

    return members
  } catch (error) {
    console.error("❌ Error extracting member information:", error)
    if (page) {
      await page.screenshot({ path: `member-extraction-error-${Date.now()}.png` })
    }
    return []
  }
}

// Function to send email with member information
async function sendMemberInformationEmail(members: MemberData[]): Promise<void> {
  console.log("📧 Sending email with member information...")

  try {
    // Create email content
    let emailContent = "Current Members in Referrals:\n\n"

    members.forEach((member, index) => {
      emailContent += `Member ${index + 1}:\n`
      emailContent += `Name: ${member.memberName}\n`
      emailContent += `ID: ${member.memberID}\n`

      if (member.serviceName) {
        emailContent += `Service: ${member.serviceName}\n`
      }

      if (member.status) {
        emailContent += `Status: ${member.status}\n`
      }

      if (member.requestDate) {
        emailContent += `Request Date: ${member.requestDate}\n`
      }

      emailContent += "\n"
    })

    // Send the email
    await sendEmail("Availity Referrals - Current Members", emailContent)
    console.log("✅ Email with member information sent successfully")
  } catch (error) {
    console.error("❌ Error sending member information email:", error)
  }
}

// Function to save members to database
async function saveMembersToDatabase(members: MemberData[]): Promise<void> {
  console.log("💾 Saving members to database...")

  try {
    for (const member of members) {
      // Check if member already exists in database
      const existingMember = await Referral.findOne({
        memberID: member.memberID,
        memberName: member.memberName,
      })

      if (!existingMember) {
        console.log(`Adding new member to database: ${member.memberName} (${member.memberID})`)

        // Create new referral record
        const newReferral = await Referral.create({
          memberName: member.memberName,
          memberID: member.memberID,
          serviceName: member.serviceName || "",
          status: member.status || "",
          requestOn: member.requestDate || new Date().toISOString(),
          isNotified: true, // Already notified since we're extracting it now
        })

        console.log(`✅ Member saved to database with ID: ${newReferral._id}`)

        // Create notification
        const notification = await Notification.create({
          referralId: newReferral._id,
          memberName: member.memberName,
          memberID: member.memberID,
          message: `Member found in referrals: ${member.memberName} (${member.serviceName || "No service specified"})`,
        })

        console.log(`✅ Notification created with ID: ${notification._id}`)

        // Send SMS notification for new member
        await sendSMS(
          `New member in referrals: ${member.memberName} (${member.memberID}). Check dashboard for details.`,
        )
      } else {
        console.log(`Member already exists in database: ${member.memberName} (${member.memberID})`)
      }
    }

    console.log("✅ All members processed and saved to database")
  } catch (error) {
    console.error("❌ Error saving members to database:", error)
  }
}

// Fix the syntax error in checkForNewReferrals function
export async function checkForNewReferrals(): Promise<void> {
  console.log("Starting check for new referrals...")
  try {
    // Ensure we're logged in
    console.log("Ensuring we are logged in to Availity...")
    const isLoggedIn = await loginToAvaility()
    if (!isLoggedIn) {
      console.error("Failed to login to Availity")
      throw new Error("Failed to login to Availity")
    }
    console.log("Successfully logged in to Availity")

    // Get session cookies
    console.log("Retrieving session cookies...")
    const cookies = await getSessionCookies()
    console.log("Session cookies retrieved successfully")

    // Extract XSRF token
    const xsrfToken = extractXsrfToken(cookies)
    console.log(`XSRF token extracted: ${xsrfToken.substring(0, 10)}...`)

    // Make API request to fetch referrals
    console.log("Making API request to fetch referrals...")
    const response = await axios.post<ReferralResponse>(
      REFERRALS_API_URL,
      {
        brand: "WLP",
        npi: "1184328189",
        papi: "",
        state: "TN",
        tabStatus: "INCOMING",
        taxId: "922753606",
      },
      {
        headers: {
          Cookie: cookies,
          "Content-Type": "application/json",
          "X-XSRF-TOKEN": xsrfToken,
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
          Referer: "https://apps.availity.com/public/apps/care-central/",
        },
      },
    )

    console.log(`API request successful. Retrieved ${response.data.referrals.length} total referrals`)

    const currentTime = new Date()
    console.log(`Current time: ${currentTime.toISOString()}`)
    console.log(`Last check time: ${lastCheckTime.toISOString()}`)

    const newReferrals = response.data.referrals.filter((referral) => {
      const requestDate = new Date(referral.requestOn)
      return requestDate > lastCheckTime
    })

    console.log(`Found ${newReferrals.length} new referrals since last check`)

    if (newReferrals.length > 0) {
      // Process each new referral
      for (const referral of newReferrals) {
        console.log(`Processing new referral for member: ${referral.memberName} (ID: ${referral.memberID})`)

        // Check if referral already exists in database
        console.log("Checking if referral already exists in database...")
        const existingReferral = await Referral.findOne({
          memberID: referral.memberID,
          requestOn: referral.requestOn,
        })

        if (!existingReferral) {
          console.log("Referral does not exist in database. Saving new referral...")
          // Save the new referral
          const savedReferral = await Referral.create({
            ...referral,
            isNotified: false,
          })
          console.log(`Referral saved to database with ID: ${savedReferral._id}`)

          // Create notification
          console.log("Creating notification record...")
          const notification = await Notification.create({
            referralId: savedReferral._id,
            memberName: referral.memberName,
            memberID: referral.memberID,
            message: `New referral for ${referral.memberName} (${referral.serviceName}) received on ${referral.requestOn}`,
          })
          console.log(`Notification created with ID: ${notification._id}`)

          // Send email notification
          console.log("Sending email notification...")
          await sendEmail(
            "New Referral Notification",
            `New referral received for ${referral.memberName} (ID: ${referral.memberID}).\n\n` +
              `Service: ${referral.serviceName}\n` +
              `Region: ${referral.regionName}\n` +
              `County: ${referral.county}\n` +
              `Plan: ${referral.plan}\n` +
              `Preferred Start Date: ${referral.preferredStartDate}\n` +
              `Status: ${referral.status}`,
          )

          // Send SMS notification
          console.log("Sending SMS notification...")
          await sendSMS(
            `New referral: ${referral.memberName} (${referral.memberID}) for ${referral.serviceName}. Check dashboard for details.`,
          )

          // Mark as notified
          console.log("Marking referral as notified...")
          savedReferral.isNotified = true
          await savedReferral.save()
          console.log("Referral marked as notified")
        } else {
          console.log(`Referral already exists in database with ID: ${existingReferral._id}`)
        }
      }
    } else {
      console.log("No new referrals found since last check")
    }

    // Update last check time
    console.log(`Updating last check time from ${lastCheckTime.toISOString()} to ${currentTime.toISOString()}`)
    lastCheckTime = currentTime
    console.log("Referral check completed successfully")
  } catch (error) {
    console.error("Error checking for new referrals:", error)

    // Check if it's an Axios error and handle authentication errors
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError
      if (axiosError.response && (axiosError.response.status === 401 || axiosError.response.status === 403)) {
        console.log("Authentication error detected. Attempting to re-login...")
        // Clear browser session and try again
        await closeBrowser()
        browser = null
        page = null
        throw error // Let the caller handle the retry
      }
    }

    throw error
  }
}

function extractXsrfToken(cookies: string): string {
  const match = cookies.match(/XSRF-TOKEN=([^;]+)/)
  return match ? match[1] : ""
}

// Add a function to start the monitoring process with reduced interval (3 minutes)
export async function startReferralMonitoring(intervalMinutes = 3): Promise<void> {
  console.log(`Starting referral monitoring with ${intervalMinutes} minute interval`)

  // Initial check
  try {
    await checkForNewReferrals()
  } catch (error) {
    console.error("Error in initial referral check:", error)
  }

  // Set up interval
  setInterval(
    async () => {
      try {
        await checkForNewReferrals()
      } catch (error) {
        console.error("Error in scheduled referral check:", error)
      }
    },
    intervalMinutes * 60 * 1000,
  )
}

