import { Telegraf } from "telegraf";
import rateLimit from "telegraf-ratelimit";
import * as dotEnv from "dotenv";
import express from "express";
import mongoose from "mongoose";

dotEnv.config({ path: "./config.env" });

mongoose.connect(process.env.MONGO_URI || "")
  .then(() => console.log("Connected to MongoDB Atlas successfully!"))
  .catch((err) => console.error("MongoDB connection error:", err));

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  userId: { type: String, required: true, select: false }, 
  username: { type: String, default: "" },
  name: { type: String, required: true },
  gender: { type: String, enum: ["Male", "Female", "Other"], required: true },
  age: { type: Number, required: true },
  isPremium: { type: Boolean, default: false },
  registeredAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

const bot = new Telegraf(process.env.Token || "");

// Catches and logs runtime network or API errors without crashing the process.
bot.catch((err, ctx) => {
  console.error(`[Telegraf Error Handled] Exception occurred on update_id: ${ctx?.update?.update_id}:`, err.message || err);
});

const limitConfig = {
  window: 2000, 
  limit: 5,     
  onLimitExceeded: (ctx) => ctx.reply("Please avoid spamming the bot!").catch(() => {}),
};
bot.use(rateLimit(limitConfig));

const userRegistrationStates = new Map(); 
const pairedPartners = new Map();       

// Structured RAM Queues for processing gender-filtered matching pools
const activeUsers = {
  Male: [],
  Female: [],
  Other: [],
  any: []
};

const mainMenuKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "🔍 Search" }, { text: "👫 Search by Gender" }]
    ],
    resize_keyboard: true
  }
};

// Initiates profile registration workflow or greets existing users after updating their handles.
bot.start(async (ctx) => {
  const tId = ctx.chat.id;
  const currentUsername = ctx.chat.username || "";

  try {
    const existingUser = await User.findOne({ telegramId: tId });
    
    if (existingUser) {
      if (existingUser.username !== currentUsername) {
        existingUser.username = currentUsername;
        await existingUser.save();
      }
      return ctx.reply(`Welcome back, ${existingUser.name}! Choose an action below: \search - To connect with Male`, mainMenuKeyboard);
    }

    ctx.reply("Welcome to the ChatBot! Set up your profile to continue.\nPlease type your name:");
    userRegistrationStates.set(tId, { step: "AWAITING_NAME" });
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred. Please try /start again.").catch(() => {});
  }
});

// Displays an interactive dashboard card containing current database records and edit controls.
bot.command("profile", async (ctx) => {
  const tId = ctx.chat.id;

  try {
    const profile = await User.findOne({ telegramId: tId });
    if (!profile) return ctx.reply("You must complete your profile first! Type /start to register.");

    const text = `Your Profile Details:\n\n👤 Name: ${profile.name}\n🎂 Age: ${profile.age}\n⚥ Gender: ${profile.gender}\n🌟 Premium Status: ${profile.isPremium ? "Active" : "Inactive"}`;
    
    ctx.reply(text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✏️ Edit Name", callback_data: "edit_name" }],
          [{ text: "✏️ Edit Age", callback_data: "edit_age" }],
          [{ text: "✏️ Edit Gender", callback_data: "edit_gender" }]
        ]
      }
    });
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred loading your profile parameters.").catch(() => {});
  }
});

// Shifts a user state path flow directly into editing specific field targets.
bot.action(/edit_(name|age|gender)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const field = ctx.match[1];
  const tId = ctx.chat.id;

  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  if (field === "name") {
    ctx.reply("Please enter your new name text below:");
    userRegistrationStates.set(tId, { step: "EDITING_NAME" });
  } else if (field === "age") {
    ctx.reply("Please type your new numeric age value below:");
    userRegistrationStates.set(tId, { step: "EDITING_AGE" });
  } else if (field === "gender") {
    ctx.reply("Select your new gender mapping:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Male ♂️", callback_data: "gender_Male" }],
          [{ text: "Female ♀️", callback_data: "gender_Female" }]
        ]
      }
    });
  }
});

bot.command("terms", (ctx) => {
  const termsText = `Terms of Service:\n1. Be respectful to your chat partners.\n2. Do not share explicit media, spam, or scam links.\n3. Harassment will result in permanent service termination.`;
  ctx.reply(termsText).catch(() => {});
});

bot.command("help", (ctx) => {
  const helpText = `Bot Help Guide:\n\n/start - start the bot\n/profile - View and modify your profile details\n/search - Find a new partner to chat with\n/next - Stop current session and find new partner\n/stop - skip the current partner\n/link - Share your telegram id\n/terms - View bot service legal info\n/help - View this bot's helper guide`;
  ctx.reply(helpText).catch(() => {});
});

const displayPayScreen = (ctx) => {
  const infoText = `The advantages of being a premium user:

No ads:
ads don't be shown to premium users

Search by gender:
Premium users can search partners by gender

Support the chat:
This is the most valuable part of premium subscription. 
The more you support us, the less ads we send`;

  ctx.reply(infoText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Pay for 1 Week (50 Stars)", callback_data: "buy_week" }],
        [{ text: "Pay for 1 Month (150 Stars)", callback_data: "buy_month" }]
      ]
    }
  }).catch(() => {});
};

bot.command("pay", (ctx) => {
  displayPayScreen(ctx);
});

bot.command("search", (ctx) => handleSearch(ctx, false));
bot.hears("🔍 Search", (ctx) => handleSearch(ctx, false));

// Helper function to thoroughly clear a specific user ID from all matching queues.
function initialQueueCleanup(tId) {
  activeUsers.Male = activeUsers.Male.filter(id => id !== tId);
  activeUsers.Female = activeUsers.Female.filter(id => id !== tId);
  activeUsers.Other = activeUsers.Other.filter(id => id !== tId);
  activeUsers.any = activeUsers.any.filter(id => id !== tId);
}

// Matches available users together in real-time or places them inside the waiting queue.
async function handleSearch(ctx, useGenderFilter = false) {
  const tId = ctx.chat.id;
  const currentUsername = ctx.chat.username || "";

  try {
    const userProfile = await User.findOne({ telegramId: tId });
    if (!userProfile) {
      return ctx.reply("You must complete your profile first! Type /start to register.");
    }

    if (userProfile.username !== currentUsername) {
      userProfile.username = currentUsername;
      await userProfile.save();
    }

    if (pairedPartners.has(tId)) {
      return ctx.reply("You are already connected to a partner! Use /stop to leave first.");
    }

    // Protection mapping to avoid double queue placement checks
    if (activeUsers.Male.includes(tId) || activeUsers.Female.includes(tId) || activeUsers.Other.includes(tId) || activeUsers.any.includes(tId)) {
      return ctx.reply("You are already searching for a partner...");
    }

    ctx.telegram.sendMessage(tId, "Searching for a partner....", {
      reply_markup: { keyboard: [[{ text: 'Stop Searching....' }]], resize_keyboard: true },
      parse_mode: "Markdown"
    }).catch(() => {});

    // Premium Gender-Filtered Matching Routing Path
    if (useGenderFilter && userProfile.isPremium) {
      const myGender = userProfile.gender;
      const targetGender = myGender === "Male" ? "Female" : myGender === "Female" ? "Male" : "Other";

      if (activeUsers[targetGender].length > 0) {
        const partnerId = activeUsers[targetGender].shift();
        initialQueueCleanup(partnerId);

        pairedPartners.set(tId, partnerId);
        pairedPartners.set(partnerId, tId);

        ctx.telegram.sendMessage(tId, "You are now connected to a partner matching your choice!", { reply_markup: { remove_keyboard: true } }).catch(() => {});
        ctx.telegram.sendMessage(partnerId, "You are now connected to a partner matching your choice!", { reply_markup: { remove_keyboard: true } }).catch(() => {});
        return;
      } else {
        activeUsers[myGender].push(tId);
        return;
      }
    }

    // Standard Free Tier or Standard Unfiltered Matching Routing Path
    if (activeUsers.any.length > 0) {
      const partnerId = activeUsers.any.shift();
      initialQueueCleanup(partnerId);

      pairedPartners.set(tId, partnerId);
      pairedPartners.set(partnerId, tId);

      ctx.telegram.sendMessage(tId, "You are now connected....", { reply_markup: { remove_keyboard: true } }).catch(() => {});
      ctx.telegram.sendMessage(partnerId, "You are now connected....", { reply_markup: { remove_keyboard: true } }).catch(() => {});
    } else {
      activeUsers.any.push(tId);
    }
  } catch (err) {
    console.error(err);
    ctx.reply("Something went wrong while processing your search request.").catch(() => {});
  }
}

// Redirects paid accounts into gender queues or forwards standard free tier users to the invoice layout.
bot.hears("👫 Search by Gender", async (ctx) => {
  const tId = ctx.chat.id;

  try {
    const userProfile = await User.findOne({ telegramId: tId });
    if (!userProfile) {
      return ctx.reply("You must complete your profile first! Type /start to register.");
    }

    if (!userProfile.isPremium) {
      return displayPayScreen(ctx);
    }

    ctx.reply("Gender wise search is active. (Premium filter functional)").catch(() => {});
    handleSearch(ctx, true);
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred verifying premium status.").catch(() => {});
  }
});

// Automatically terminates the active conversation pair sequence and launches a fresh search queue routing.
bot.command("next", async (ctx) => {
  const userId = ctx.chat.id;
  const partnerId = pairedPartners.get(userId);
  if (partnerId) {
    ctx.telegram.sendMessage(userId, "You left the chat! Searching for a new partner...", { reply_markup: { remove_keyboard: true } }).catch(() => {});
    ctx.telegram.sendMessage(partnerId, "Your partner left the chat! Use /search or the menu to find a new partner.", mainMenuKeyboard).catch(() => {});
    pairedPartners.delete(partnerId);
    pairedPartners.delete(userId);
  } else {
    initialQueueCleanup(userId);
  }
  handleSearch(ctx, false);
});

// Removes a searching user from the waiting queue layout pool.
bot.hears("Stop Searching....", (ctx) => {
  const userId = ctx.chat.id;
  initialQueueCleanup(userId);
  ctx.reply("Stopped searching for a partner.", mainMenuKeyboard).catch(() => {});
});

// Terminates an active connection between paired users and resets their states.
bot.command("stop", (ctx) => {
  const userId = ctx.chat.id;
  const partnerId = pairedPartners.get(userId);
  if (partnerId) {
    ctx.telegram.sendMessage(userId, `You left the chat!!\n/search - use this to search for a new partner...`, mainMenuKeyboard).catch(() => {});
    ctx.telegram.sendMessage(partnerId, `Your partner left the chat!\n/search - use this to search for a new partner....`, mainMenuKeyboard).catch(() => {});
    pairedPartners.delete(partnerId);
    pairedPartners.delete(userId);
  } else {
    ctx.reply(`You are not in a chat!\n/search - use this to search for a new partner😁`, mainMenuKeyboard).catch(() => {});
  }
});

// Shares the current user's public Telegram handle with their connected partner.
bot.command("link", (ctx) => {
  const userId = ctx.chat.id;
  const partnerId = pairedPartners.get(userId);
  if (!partnerId) return ctx.reply("You are not in a chat!").catch(() => {});
  if (!ctx.chat.username) return ctx.reply("Set a public Telegram username first in your profile.").catch(() => {});
  ctx.telegram.sendMessage(partnerId, "@" + ctx.chat.username).catch(() => {});
});

// Generates an automated invoice configuration parameters payload tracking Telegram Stars subscription purchases.
const sendStarsInvoice = async (ctx, dynamicTitle, dynamicAmount) => {
  try {
    await ctx.replyWithInvoice({
      title: dynamicTitle,
      description: "Activate access to gender matching routing layers and remove advertisements.",
      payload: `premium_${ctx.chat.id}_${Date.now()}`,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: dynamicTitle, amount: dynamicAmount }]
    });
  } catch (err) {
    console.error("Invoice deployment failure:", err);
    ctx.reply("Unable to load checkout window. Please try again.").catch(() => {});
  }
};

bot.action("buy_week", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  sendStarsInvoice(ctx, "Premium Weekly Subscription", 50);
});

bot.action("buy_month", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  sendStarsInvoice(ctx, "Premium Monthly Subscription", 150);
});

// Validates the transaction constraints prior to allowing checkout updates to process.
bot.on("pre_checkout_query", async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error("Pre-checkout verification failure:", err);
  }
});

// Intercepts successful Telegram Stars payment updates and flags premium state privileges inside MongoDB.
bot.on("successful_payment", async (ctx) => {
  const tId = ctx.chat.id;
  try {
    await User.findOneAndUpdate({ telegramId: tId }, { isPremium: true });
    ctx.reply("Payment Successful! Premium benefits have been unlocked successfully.", mainMenuKeyboard).catch(() => {});
  } catch (err) {
    console.error("Post-payment record sync failure:", err);
    ctx.reply("Payment received, error updating account records. Please contact support.").catch(() => {});
  }
});

// Processes selected gender values and updates profile metrics or initializes parameters dynamically.
bot.action(/gender_(.+)/, async (ctx) => {
  const userId = ctx.chat.id;
  const selectedGender = ctx.match[1];
  const state = userRegistrationStates.get(userId);
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  try {
    const existingProfile = await User.findOne({ telegramId: userId });
    if (existingProfile && (!state || state.step !== "AWAITING_GENDER")) {
      existingProfile.gender = selectedGender;
      await existingProfile.save();
      return ctx.reply(`Gender updated successfully to: ${selectedGender}`, mainMenuKeyboard);
    }
    if (!state || state.step !== "AWAITING_GENDER") return ctx.reply("Session expired. Type /start.").catch(() => {});
    const systemGeneratedUserId = `usr_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
    await User.findOneAndUpdate(
      { telegramId: userId },
      {
        userId: systemGeneratedUserId,
        username: ctx.chat.username || "",
        name: state.name,
        age: state.age,
        gender: selectedGender
      },
      { upsert: true, new: true }
    );
    userRegistrationStates.delete(userId);
    ctx.reply(`Profile saved successfully!\nName: ${state.name}\nAge: ${state.age}\nGender: ${selectedGender}\n\nUse /search or the menu to begin!`, mainMenuKeyboard).catch(() => {});
  } catch (err) {
    console.error(err);
    ctx.reply("Error processing gender update. Please use /profile or /start to retry.").catch(() => {});
  }
});

// Manages the conversation registration setup tracking steps or routes active structural chat copy logs.
bot.on("message", async (ctx) => {
  const userId = ctx.chat.id;
  const regState = userRegistrationStates.get(userId);
  if (regState) {
    const textInput = ctx.message.text ? ctx.message.text.trim() : "";
    if (regState.step === "AWAITING_NAME") {
      if (!textInput) return ctx.reply("Please input a valid text name.");
      userRegistrationStates.set(userId, { step: "AWAITING_AGE", name: textInput });
      return ctx.reply("Excellent! Now, please type your age:");
    }
    if (regState.step === "AWAITING_AGE") {
      const parsedAge = parseInt(textInput, 10);
      if (isNaN(parsedAge) || parsedAge <= 0 || parsedAge > 120) {
        return ctx.reply("Please enter a valid numeric age value (e.g., 21):");
      }
      userRegistrationStates.set(userId, { step: "AWAITING_GENDER", name: regState.name, age: parsedAge });
      return ctx.reply("Select your gender:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Male ♂️", callback_data: "gender_Male" }],
            [{ text: "Female ♀️", callback_data: "gender_Female" }]
          ]
        }
      });
    }
    if (regState.step === "EDITING_NAME") {
      if (!textInput) return ctx.reply("Please input a valid text name.");
      try {
        await User.findOneAndUpdate({ telegramId: userId }, { name: textInput });
        userRegistrationStates.delete(userId);
        return ctx.reply(`Name updated to: ${textInput}`, mainMenuKeyboard);
      } catch (err) {
        console.error(err);
        return ctx.reply("Error updating name. Type /profile to retry.");
      }
    }
    if (regState.step === "EDITING_AGE") {
      const parsedAge = parseInt(textInput, 10);
      if (isNaN(parsedAge) || parsedAge <= 0 || parsedAge > 120) {
        return ctx.reply("Please enter a valid numeric age value:");
      }
      try {
        await User.findOneAndUpdate({ telegramId: userId }, { age: parsedAge });
        userRegistrationStates.delete(userId);
        return ctx.reply(`Age updated to: ${parsedAge}`, mainMenuKeyboard);
      } catch (err) {
        console.error(err);
        return ctx.reply("Error updating age. Type /profile to retry.");
      }
    }
    return;
  }
  const partnerId = pairedPartners.get(userId);
  if (partnerId) {
    ctx.telegram.copyMessage(partnerId, userId, ctx.message.message_id).catch(() => {});
  } else {
    ctx.reply("You are not in a conversation! Use /search or the menu below to find a partner.", mainMenuKeyboard).catch(() => {});
  }
});

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
app.use(express.json());
app.get("/", (req, res) => res.send("Bot status: Operational."));
app.get("/ping", (req, res) => res.send("pong"));

// Initializes the Express system service infrastructure, binding long-polling or production webhook layers.
app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  if (IS_PRODUCTION && APP_URL) {
    const SECRET_PATH = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(SECRET_PATH));
    try {
      await bot.telegram.setWebhook(`${APP_URL}${SECRET_PATH}`);
      console.log("Production Webhook active on Render!");
    } catch (err) {
      console.error("Webhook binding error:", err.message);
    }
    setInterval(() => {
      fetch(`${APP_URL}/ping`)
        .then(() => console.log("Keep-awake ping sent!"))
        .catch((err) => console.error("Keep-awake ping failed:", err.message));
    }, 5 * 60 * 1000);
  } else {
    console.log("Running locally in Long-Polling Mode. No webhooks needed.");
    bot.launch().catch((err) => {
      console.error("[Telegraf Startup Error Handled]: Failed to initiate long-polling connection:", err.message || err);
    });
  }
});
