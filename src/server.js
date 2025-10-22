import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcode from "qrcode-terminal";
import puppeteer from "puppeteer";
import userRoutes from "./routes/userRoutes.js";
import prisma from "../src/db.js";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// ✅ Global browser and page management
let globalBrowser = null;
let globalPage = null;
let isBrowserInitializing = false;

const app = express();
const PORT = 3010;
const ADMIN_PASS = "9832";
const RENEWAL_MESSAGE = `Assalam-o-Alaikum, Dear Member,

Your subscription to “Freepik Premium by Mubashir Awan” is about to expire. To continue accessing our files, please renew your subscription.

Plans Available:
✨ Basic – 10 files/day | 299 PKR
✨ Standard (Most Popular) 20 files/day | 349 PKR
✨ Premium – 30 files/day | 379 PKR

Payment Details:
JazzCash: 03319818561
Name: Mubashir Mehmood Awan

Note: Payment will only be accepted with a valid screenshot.

Admin Mubashir Awan
Thank you for being part of our community.`;

const NOT_REGISTERED_MESSAGE = `Assalam-o-Alaikum, Dear User,

You are not registered in our system. Please contact the admin to get registered and start using our services.

If you wish to join our premium plans, please see the details below:

Your subscription to “Freepik Premium by Mubashir Awan” gives you access to high-quality premium files.

Plans Available:
✨ Basic – 10 files/day | 299 PKR
✨ Standard (Most Popular) – 20 files/day | 349 PKR
✨ Premium – 30 files/day | 379 PKR

Payment Details:
JazzCash: 03319818561
Name: Mubashir Mehmood Awan

Note: Payment will only be accepted with a valid screenshot.

Please contact Admin Mubashir Awan to complete your registration.

Thank you for your interest in our community.`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// point to src/public
app.use(express.static(path.join(__dirname, "public")));

app.use(express.json());

/**
 * Initialize global browser and create a page
 */
async function initGlobalBrowser() {
  if (isBrowserInitializing) {
    // Wait for initialization to complete
    while (isBrowserInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return;
  }

  if (globalBrowser && globalPage) {
    return; // Already initialized
  }

  try {
    isBrowserInitializing = true;
    console.log("🔄 Initializing global browser...");

    globalBrowser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      devtools: false,
      userDataDir: "../my-user-data",
    });

    globalPage = await globalBrowser.newPage();

    // Set up request interception once
    // await globalPage.setRequestInterception(true);

    // Navigate to a placeholder page initially
    // const url = "https://www.freepik.com/"
    // await globalPage.goto(url, { waitUntil: "networkidle2" });
    // await globalPage.goto("about:blank")
    const url = "https://www.freepik.com/";
    console.log(`🌐 Opening Freepik homepage: ${url}`);
    await globalPage.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    console.log("✅ Global browser initialized successfully");
  } catch (error) {
    console.error("❌ Error initializing global browser:", error);
    globalBrowser = null;
    globalPage = null;
  } finally {
    isBrowserInitializing = false;
  }
}

/**
 * Ensure browser is available and healthy
 */
async function ensureBrowserHealth() {
  try {
    if (!globalBrowser || !globalPage) {
      await initGlobalBrowser();
      return;
    }

    // Check if browser is still connected
    if (globalBrowser.isConnected()) {
      // Try to interact with the page to ensure it's responsive
      await globalPage.evaluate(() => document.readyState);
    } else {
      throw new Error("Browser disconnected");
    }
  } catch (error) {
    console.log("🔧 Browser needs reinitialization:", error.message);
    globalBrowser = null;
    globalPage = null;
    await initGlobalBrowser();
  }
}

/**
 * Navigate to URL using global page
 */
async function navigateToUrl(url) {
  await ensureBrowserHealth();

  try {
    console.log(`🔄 Navigating to: ${url}`);
    await globalPage.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    return true;
  } catch (error) {
    console.error("❌ Navigation error:", error);
    return false;
  }
}

/**
 * Enhanced getUrl function using global browser
 */
async function getUrl(url) {
  await ensureBrowserHealth();

  try {
    // Navigate to the URL
    const navigationSuccess = await navigateToUrl(url);
    if (!navigationSuccess) {
      throw new Error("Failed to navigate to URL");
    }
    await globalPage.setRequestInterception(true);
    // Set up download URL detection
    const urlPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout: Download URL not found within 30 seconds"));
      }, 30000);

      const requestHandler = async (req) => {
        const reqUrl = req.url();
        console.log("Request URL:", reqUrl);

        if (
          reqUrl.includes("downloadscdn5.freepik.com") ||
          reqUrl.includes("downloadscdn6.freepik.com") ||
          reqUrl.includes("videocdn.cdnpk.net")
        ) {
          console.log("✅ Found Download URL:", reqUrl);
          clearTimeout(timeout);
          globalPage.off("request", requestHandler); // Remove listener
          resolve(reqUrl);
          return;
        }
        req.continue();
      };

      globalPage.on("request", requestHandler);
    });

    // Wait for download button and click it
    await globalPage.waitForSelector("button[data-cy='download-button']", {
      visible: true,
      timeout: 10000,
    });
    await globalPage.click("button[data-cy='download-button']");
    console.log("⬇️ Download button clicked...");

    const foundUrl = await urlPromise;
    console.log("Finally found URL:", foundUrl);
    globalPage.setRequestInterception(false);
    return foundUrl;
  } catch (err) {
    console.error("❌ Error in getUrl:", err);
    globalPage.setRequestInterception(false);
    return;
  }
}

/**
 * Check user subscription and daily request limits
 */
async function checkSubscription(wId) {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    const user = await prisma.user.findFirst({
      where: { wId },
      include: {
        subscription: true,
        Request: {
          where: {
            date: {
              gte: startOfToday,
              lt: startOfTomorrow,
            },
          },
        },
      },
    });

    if (!user) {
      return {
        valid: false,
        reason: "User not found",
        userId: null,
        requestsToday: 0,
        limit: 0,
      };
    }

    // Check if user has an active subscription and it hasn't expired
    if (!user.subscription) {
      return {
        valid: false,
        reason: "No active subscription",
        userId: user.id,
        requestsToday: user.Request.length,
        limit: 0,
      };
    }

    // Check if subscription has expired
    if (user.subscription.expiresAt < new Date()) {
      return {
        valid: false,
        reason: "Subscription expired",
        userId: user.id,
        requestsToday: user.Request.length,
        limit: 0,
      };
    }

    const activeSubscription = user.subscription.plan;
    console.log("plan", activeSubscription);

    const requestsToday = user.Request.length;
    console.log("length", requestsToday); // Fixed syntax error

    // Set daily limits based on subscription plan
    let dailyLimit;
    switch (activeSubscription) {
      case "BASIC":
        dailyLimit = 10;
        break;
      case "STANDARD":
        dailyLimit = 20;
        break;
      case "PREMIUM":
        dailyLimit = 30;
        break;
      default:
        dailyLimit = 0; // fallback
    }

    // Check if user has exceeded daily limit
    if (dailyLimit > 0 && requestsToday >= dailyLimit) {
      return {
        valid: false,
        reason: "Daily limit exceeded",
        userId: user.id,
        requestsToday,
        limit: dailyLimit,
      };
    }

    return {
      valid: true,
      reason: "Valid subscription",
      userId: user.id,
      requestsToday,
      limit: dailyLimit,
      subscription: activeSubscription,
    };
  } catch (error) {
    console.error("❌ Error checking subscription:", error);
    return {
      valid: false,
      reason: "Database error",
      userId: null,
      requestsToday: 0,
      limit: 0,
    };
  }
}

/**
 * Create a new request record
 */
async function createRequest(userId) {
  try {
    const request = await prisma.request.create({
      data: {
        userId: userId, // Required
        // date will be auto-set by Prisma, no need to pass it unless you want a custom date
      },
      include: {
        user: true, // Optional: include user info in the response
      },
    });

    console.log("✅ Request created:", request);
    return request;
  } catch (error) {
    console.error("❌ Error creating request:", error);
    throw error;
  }
}

// Create bot with local session storage
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true },
});

// Show QR code for login
client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("📱 Scan this QR with WhatsApp");
});

async function sendRenewalReminders() {
  try {
    const now = new Date();

    const subscriptions = await prisma.subscription.findMany({
      where: {
        expiresAt: { gt: now },
      },
      include: { user: true },
    });

    for (const sub of subscriptions) {
      const daysLeft = Math.ceil((sub.expiresAt - now) / (1000 * 60 * 60 * 24));

      let shouldSend = false;
      let fieldToUpdate = null;

      if (daysLeft === 7 && !sub.reminderDay7Send) {
        shouldSend = true;
        fieldToUpdate = "reminderDay7Send";
      } else if (daysLeft === 4 && !sub.reminderDay4Send) {
        shouldSend = true;
        fieldToUpdate = "reminderDay4Send";
      } else if (daysLeft === 1 && !sub.reminderDay1Send) {
        shouldSend = true;
        fieldToUpdate = "reminderDay1Send";
      }

      if (shouldSend) {
        try {
          await client.sendMessage(`${sub.user.wId}@c.us`, RENEWAL_MESSAGE);
          console.log(
            `📩 Sent renewal reminder to ${sub.user.wId} (${daysLeft} days left)`
          );

          // Update the subscription to mark reminder as sent
          await prisma.subscription.update({
            where: { id: sub.id },
            data: { [fieldToUpdate]: true },
          });
        } catch (error) {
          console.error(
            `❌ Failed to send reminder to ${sub.user.wId}:`,
            error
          );
        }
      }
    }
  } catch (error) {
    console.error("❌ Error in sending renewal reminders:", error);
  }
}

// Bot is ready
client.on("ready", async () => {
  console.log("✅ WhatsApp Bot is ready!");
  // Initialize global browser when bot is ready
  // await initGlobalBrowser();

  await sendRenewalReminders();

  setInterval(sendRenewalReminders, 12 * 60 * 60 * 1000); // Every 24 hours
});

// Handle group messages
client.on("message", async (msg) => {
  console.log("📩 New message received:", msg.body);

  if (!msg.from.endsWith("@g.us")) {
    console.log("Not from a group, ignoring...");
    return;
  }

  const botId = "84868620914800";
  const mentioned = msg.mentionedIds.map((id) => id.replace(/@.+$/, ""));

  if (mentioned.includes(botId)) {
    console.log("✅ Bot was mentioned!");

    // Utility function for random delay between 2–3 seconds
    const randomDelay = () =>
      new Promise((resolve) =>
        setTimeout(resolve, 2000 + Math.random() * 1000)
      );

    try {
      // Wait before reacting
      await randomDelay();
      await msg.react("👍");
    } catch (error) {
      console.error("❌ Error reacting to message:", error);
    }

    const senderId = msg.author;
    const senderContact = await msg.getContact();

    const urlMatch = msg.body.match(/https?:\/\/[^\s]+/);
    if (!urlMatch) {
      await randomDelay();
      await msg.reply(
        `@${senderContact.number}! Please mention me with a valid link.`,
        msg.from,
        { mentions: [senderContact] }
      );
      return;
    }

    const link = urlMatch[0];
    console.log("🔗 Link received:", link);

    const subscription = await checkSubscription(senderContact.number);
    console.log(subscription);

    if (!subscription.valid) {
      let errorMessage = `@${senderContact.number}! `;

      switch (subscription.reason) {
        case "User not found":
          errorMessage += NOT_REGISTERED_MESSAGE;
          break;
        case "No active subscription":
          errorMessage +=
            "You don't have an active subscription. Please contact the admin.";
          break;
        case "Daily limit exceeded":
          errorMessage += `You have exceeded your daily limit of ${subscription.limit} requests. You've used ${subscription.requestsToday} requests today.`;
          break;
        case "Subscription expired":
          errorMessage += `Your subscription expired. Please contact the admin.`;
          break;
        default:
          errorMessage +=
            "Subscription validation failed. Please contact the admin.";
      }

      await randomDelay();
      await msg.reply(errorMessage, msg.from, {
        mentions: [senderContact],
      });
      return;
    }

    try {
      // Add random delay before fetching download URL
      await randomDelay();
      const downloadUrl = await getUrl(link);

      if (downloadUrl) {
        const request = await createRequest(subscription.userId);

        // Random delay before sending message
        await randomDelay();
        await client.sendMessage(
          msg.from,
          `✅ Hey @${
            senderContact.number
          }, I got your download link:\n${downloadUrl}\n\n📊 Usage: ${
            subscription.requestsToday + 1
          }/${
            subscription.limit === 0 ? "∞" : subscription.limit
          } requests today`,
          { mentions: [senderContact] }
        );
      } else {
        await randomDelay();
        await client.sendMessage(
          msg.from,
          `Hey @${senderContact.number}, something went wrong. Please inform the admin.`,
          { mentions: [senderContact] }
        );
      }
    } catch (error) {
      console.error("❌ Error processing request:", error);
      const failedRequest = await createRequest(
        subscription.userId,
        link,
        "failed"
      );

      await randomDelay();
      await client.sendMessage(
        msg.from,
        `❌ Sorry @${senderContact.number}, I couldn't process your link. Please try again later.`,
        { mentions: [senderContact] }
      );
    }
  } else {
    console.log("Bot not mentioned, ignoring...");
  }
});

// Graceful shutdown handling
process.on("SIGINT", async () => {
  console.log("🔄 Shutting down gracefully...");

  if (globalBrowser) {
    await globalBrowser.close();
    console.log("✅ Browser closed");
  }

  if (client) {
    await client.destroy();
    console.log("✅ WhatsApp client destroyed");
  }

  process.exit(0);
});

// Express routes
app.get("/home", (req, res) => {
  res.send("Hello! Express server is working 🚀");
});

app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASS) {
    return res.sendStatus(200);
  }
  res.sendStatus(401);
});

// Browser status endpoint
app.get("/api/browser-status", async (req, res) => {
  try {
    await ensureBrowserHealth();
    res.json({
      status: "healthy",
      browserConnected: globalBrowser ? globalBrowser.isConnected() : false,
      pageReady: globalPage ? true : false,
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    });
  }
});

const randomDelay = () =>
  new Promise((resolve) => setTimeout(resolve, 2000 + Math.random() * 1000));

app.use("/users", userRoutes);

// Start express server
app.listen(PORT, () => {
  console.log(`🚀 Express server running at http://localhost:${PORT}`);
});

// Initialize WhatsApp client
client.initialize();
