import express from "express";
import mongoose from "mongoose";
import path from "path";
import { config } from "dotenv";
import { setupBot, loginToAvaility } from "./services/bot"; // Import bot functions

// Load environment variables
config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));


// Route to start the bot
app.post("/start-bot", async (req, res) => {
  try {
    console.log("🚀 Starting bot from interface...");
    await setupBot(); // Initialize the bot
    const loginSuccess = await loginToAvaility(); // Attempt to log in
    if (loginSuccess) {
      res.status(200).json({ message: "Bot started and logged in successfully!" });
    } else {
      res.status(500).json({ message: "Bot failed to log in." });
    }
  } catch (error) {
    console.error("❌ Error starting bot:", error);
    res.status(500).json({ message: "Failed to start bot.", error: (error as any).message });
  }
});

// Database connection
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/availity-automation")
  .then(async () => {
    console.log("Connected to MongoDB");

    
    // Initialize the bot
    console.log("Initializing bot...");
    setupBot().catch((err) => {
      console.error("Failed to setup bot:", err);
    });

 

    console.log("Application initialization completed successfully");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;