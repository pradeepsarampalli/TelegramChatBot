import { Telegraf } from "telegraf";
import rateLimit from "telegraf-ratelimit";
import * as dotEnv from "dotenv";
import express from "express";
import mongoose from "mongoose";

dotEnv.config({ path: "./.env" });

mongoose
  .connect(process.env.MONGO_URI || "")
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
  premiumExpiresAt: { type: Date, default: null },
  referralCode: { type: String, unique: true, sparse: true, index: true },
  referredBy: { type: Number, default: null, index: true },
  referralCount: { type: Number, default: 0 },
  registeredAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

const bot = new Telegraf(process.env.Token || "");

bot.catch((err, ctx) => {
  console.error(
    `[Telegraf Error Handled] Exception occurred on update_id: ${ctx?.update?.update_id}:`,
    err.message || err
  );
});

bot.use(
  rateLimit({
    window: 2000,
    limit: 5,
    onLimitExceeded: (ctx) => ctx.reply("Please avoid spamming the bot!").catch(() => {})
  })
);

const userRegistrationStates = new Map();
const pairedPartners = new Map();
const activeUsers = { Male: [], Female: [], Other: [], any: [] };

const generateReferralCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

const ensurePremiumActive = async (telegramId) => {
  const user = await User.findOne({ telegramId });
  if (!user || !user.isPremium) return false;

  if (user.premiumExpiresAt && user.premiumExpiresAt.getTime() <= Date.now()) {
    user.isPremium = false;
    user.premiumExpiresAt = null;
    await user.save();
    return false;
  }
  return true;
};

const getReferralLink = async (telegramId) => {
  const user = await User.findOne({ telegramId });
  if (!user) return null;

  if (!user.referralCode) {
    let referralCode = generateReferralCode();
    while (await User.exists({ referralCode })) {
      referralCode = generateReferralCode();
    }
    user.referralCode = referralCode;
    await user.save();
  }

  const botInfo = await bot.telegram.getMe();
  return `https://t.me/${botInfo.username}?start=ref_${user.referralCode}`;
};

const mainMenuKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: "🔍 Search" }, { text: "👫 Search by Gender" }],
      [{ text: "🎁 Refer & Earn" }]
    ],
    resize_keyboard: true
  }
};

bot.start(async (ctx) => {
  const tId = ctx.chat.id;
  const currentUsername = ctx.chat.username || "";
  const startPayload = ctx.payload || "";
  const referralCode = startPayload.startsWith("ref_") ? startPayload.substring(4) : null;

  try {
    const existingUser = await User.findOne({ telegramId: tId });

    if (existingUser) {
      if (existingUser.username !== currentUsername) {
        existingUser.username = currentUsername;
        await existingUser.save();
      }
      return ctx.reply(
        `Welcome back, ${existingUser.name}! \n/search - To start search for a partner.`,
        mainMenuKeyboard
      );
    }

    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer && referrer.telegramId !== tId) {
        referredBy = referrer.telegramId;
      }
    }

    ctx.reply("Welcome to the ChatBot! Set up your profile to continue.\nPlease type your name:");
    userRegistrationStates.set(tId, { step: "AWAITING_NAME", referredBy });
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred. Please try /start again.").catch(() => {});
  }
});

const sendReferralScreen = async (ctx) => {
  const tId = ctx.chat.id;
  try {
    const profile = await User.findOne({ telegramId: tId });
    if (!profile) {
      return ctx.reply("You must complete your profile first! Type /start to register.");
    }

    const referralLink = await getReferralLink(tId);
    const referralText =
      `🎁 <b>Refer & Earn</b>\n\n` +
      `🔗 <b>Your referral link</b>\n` +
      `<code>${referralLink}</code>\n\n` +
      `👥 <b>Successful referrals:</b> ${profile.referralCount || 0}\n\n` +
      `📣 Share your link with your friends. When a new user opens your link and completes their profile, the referral is counted.`;

    return ctx.reply(referralText, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Share My Link", url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}` }],
          [{ text: "📊 My Referral Stats", callback_data: "referral_stats" }]
        ]
      }
    });
  } catch (err) {
    console.error("Referral screen error:", err);
    ctx.reply("Unable to load referral information. Please try again.").catch(() => {});
  }
};

bot.command("refer", sendReferralScreen);
bot.hears("🎁 Refer & Earn", sendReferralScreen);

bot.action("referral_stats", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  try {
    const profile = await User.findOne({ telegramId: ctx.chat.id });
    if (!profile) {
      return ctx.reply("You must complete your profile first! Type /start to register.");
    }

    const referredUsers = await User.find(
      { referredBy: ctx.chat.id },
      { name: 1, registeredAt: 1 }
    ).sort({ registeredAt: -1 });

    const statsText =
      `📊 <b>Referral Statistics</b>\n\n` +
      `👥 <b>Total successful referrals:</b> ${profile.referralCount || 0}\n` +
      `✅ <b>Completed registrations:</b> ${referredUsers.length}\n\n` +
      `🔗 <b>Your referral link:</b>\n` +
      `Share your referral link to invite more users.`;

    return ctx.reply(statsText, { parse_mode: "HTML" });
  } catch (err) {
    console.error("Referral stats error:", err);
    ctx.reply("Unable to load referral statistics. Please try again.").catch(() => {});
  }
});

bot.command("profile", async (ctx) => {
  const tId = ctx.chat.id;
  try {
    const profile = await User.findOne({ telegramId: tId });
    if (!profile) {
      return ctx.reply("You must complete your profile first! Type /start to register.");
    }

    const premiumActive = await ensurePremiumActive(tId);
    const text =
      `Your Profile Details:\n\n` +
      `👤 Name: ${profile.name}\n` +
      `🎂 Age: ${profile.age}\n` +
      `⚥ Gender: ${profile.gender}\n` +
      `🌟 Premium Status: ${premiumActive ? "Active" : "Inactive"}`;

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
  const termsText =
    `Terms of Service:\n` +
    `1. Be respectful to your chat partners.\n` +
    `2. Do not share explicit media, spam, or scam links.\n` +
    `3. Harassment will result in permanent service termination.`;
  ctx.reply(termsText).catch(() => {});
});

bot.command("help", (ctx) => {
  const helpText =
    `🤖 <b>Bot Help</b>\n\n` +
    `🚀 /start — Start bot\n` +
    `👤 /profile — Your profile\n` +
    `🔍 /search — Find partner\n` +
    `⏭️ /next — Find next partner\n` +
    `🛑 /stop — End chat\n` +
    `🔗 /link — Share Telegram ID\n` +
    `📜 /terms — Terms & rules\n` +
    `❓ /help — Help`;
  ctx.reply(helpText, { parse_mode: "HTML" }).catch(() => {});
});

const displayPayScreen = (ctx) => {
  const infoText =
    `The advantages of being a premium user:\n\n` +
    `No ads:\n` +
    `ads don't be shown to premium users\n\n` +
    `Search by gender:\n` +
    `Premium users can search partners by gender`;

  ctx.reply(infoText, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "1 Day ⭐ 49", callback_data: "buy_day" }],
        [{ text: "1 Week ⭐ 99", callback_data: "buy_week" }],
        [{ text: "1 Month ⭐ 299", callback_data: "buy_month" }]
      ]
    }
  }).catch(() => {});
};

bot.command("pay", (ctx) => displayPayScreen(ctx));
bot.command("search", (ctx) => handleSearch(ctx, false));
bot.hears("🔍 Search", (ctx) => handleSearch(ctx, false));

function initialQueueCleanup(tId) {
  activeUsers.Male = activeUsers.Male.filter((id) => id !== tId);
  activeUsers.Female = activeUsers.Female.filter((id) => id !== tId);
  activeUsers.Other = activeUsers.Other.filter((id) => id !== tId);
  activeUsers.any = activeUsers.any.filter((id) => id !== tId);
}

const connectUsers = (ctx, userId, partnerId) => {
  initialQueueCleanup(partnerId);
  initialQueueCleanup(userId);

  pairedPartners.set(userId, partnerId);
  pairedPartners.set(partnerId, userId);

  ctx.telegram.sendMessage(userId, "You are now connected to a partner!", {
    reply_markup: { remove_keyboard: true }
  }).catch(() => {});

  ctx.telegram.sendMessage(partnerId, "You are now connected to a partner!", {
    reply_markup: { remove_keyboard: true }
  }).catch(() => {});
};

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

    if (
      activeUsers.Male.includes(tId) ||
      activeUsers.Female.includes(tId) ||
      activeUsers.Other.includes(tId) ||
      activeUsers.any.includes(tId)
    ) {
      return ctx.reply("You are already searching for a partner.");
    }

    await ctx.telegram.sendMessage(tId, "Searching for a partner..", {
      reply_markup: {
        keyboard: [[{ text: "Stop Searching.." }]],
        resize_keyboard: true
      }
    }).catch(() => {});

    const myGender = userProfile.gender;
    const targetGender = myGender === "Male" ? "Female" : myGender === "Female" ? "Male" : "Other";

    if (useGenderFilter) {
      const premiumActive = await ensurePremiumActive(tId);
      if (!premiumActive) return displayPayScreen(ctx);

      if (activeUsers[targetGender].length > 0) {
        return connectUsers(ctx, tId, activeUsers[targetGender].shift());
      }
      if (activeUsers.any.length > 0) {
        return connectUsers(ctx, tId, activeUsers.any.shift());
      }

      activeUsers[myGender].push(tId);
      return;
    }

    if (activeUsers.any.length > 0) {
      return connectUsers(ctx, tId, activeUsers.any.shift());
    }

    if (activeUsers[targetGender].length > 0) {
      return connectUsers(ctx, tId, activeUsers[targetGender].shift());
    }

    activeUsers.any.push(tId);
  } catch (err) {
    console.error(err);
    ctx.reply("Something went wrong while processing your search request.").catch(() => {});
  }
}

bot.hears("👫 Search by Gender", async (ctx) => {
  const tId = ctx.chat.id;
  try {
    const userProfile = await User.findOne({ telegramId: tId });
    if (!userProfile) {
      return ctx.reply("You must complete your profile first! Type /start to register.");
    }

    const premiumActive = await ensurePremiumActive(tId);
    if (!premiumActive) return displayPayScreen(ctx);

    ctx.reply("Gender wise search is active.").catch(() => {});
    await handleSearch(ctx, true);
  } catch (err) {
    console.error(err);
    ctx.reply("An error occurred verifying premium status.").catch(() => {});
  }
});

bot.command("next", async (ctx) => {
  const userId = ctx.chat.id;
  const partnerId = pairedPartners.get(userId);

  if (partnerId) {
    ctx.telegram.sendMessage(userId, "You left the chat! Searching for a new partner..", {
      reply_markup: { remove_keyboard: true }
    }).catch(() => {});

    ctx.telegram.sendMessage(
      partnerId,
      "Your partner left the chat! Use /search or the menu to find a new partner.",
      mainMenuKeyboard
    ).catch(() => {});

    pairedPartners.delete(partnerId);
    pairedPartners.delete(userId);
  } else {
    initialQueueCleanup(userId);
  }

  await handleSearch(ctx, false);
});

bot.hears("Stop Searching..", (ctx) => {
  const userId = ctx.chat.id;
  initialQueueCleanup(userId);
  ctx.reply("Stopped searching for a partner.", mainMenuKeyboard).catch(() => {});
});

bot.command("stop", (ctx) => {
  const userId = ctx.chat.id;
  const partnerId = pairedPartners.get(userId);

  if (partnerId) {
    ctx.telegram.sendMessage(
      userId,
      `You left the chat!!\n/search - use this to search for a new partner.`,
      mainMenuKeyboard
    ).catch(() => {});

    ctx.telegram.sendMessage(
      partnerId,
      `Your partner left the chat!\n/search - use this to search for a new partner.`,
      mainMenuKeyboard
    ).catch(() => {});

    pairedPartners.delete(partnerId);
    pairedPartners.delete(userId);
  } else {
    initialQueueCleanup(userId);
    ctx.reply(
      `You are not in a chat!\n/search - use this to search for a new partner.`,
      mainMenuKeyboard
    ).catch(() => {});
  }
});

bot.command("link", (ctx) => {
  const userId = ctx.chat.id;
  const partnerId = pairedPartners.get(userId);

  if (!partnerId) {
    return ctx.reply("You are not in a chat!\n/search - use this to search for a new partner.").catch(() => {});
  }

  if (!ctx.chat.username) {
    return ctx.reply("Set a public Telegram username first in your profile.").catch(() => {});
  }

  ctx.telegram.sendMessage(userId, "Your username has been sent to your partner!").catch(() => {});
  ctx.telegram.sendMessage(partnerId, `Your partner's username\n@${ctx.chat.username}`).catch(() => {});
});

const sendStarsInvoice = async (ctx, plan, dynamicTitle, dynamicAmount) => {
  try {
    await ctx.replyWithInvoice({
      title: dynamicTitle,
      description: "Activate premium features and remove advertisements.",
      payload: `premium_${plan}_${ctx.chat.id}_${Date.now()}`,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: dynamicTitle, amount: dynamicAmount }]
    });
  } catch (err) {
    console.error("Invoice deployment failure:", err);
    ctx.reply("Unable to load checkout window. Please try again.").catch(() => {});
  }
};

bot.action("buy_day", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await sendStarsInvoice(ctx, "day", "Premium 1 Day", 49);
});

bot.action("buy_week", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await sendStarsInvoice(ctx, "week", "Premium 1 Week", 99);
});

bot.action("buy_month", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await sendStarsInvoice(ctx, "month", "Premium 1 Month", 299);
});

bot.on("pre_checkout_query", async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error("Pre-checkout verification failure:", err);
  }
});

bot.on("successful_payment", async (ctx) => {
  const tId = ctx.chat.id;

  try {
    const payment = ctx.message.successful_payment;
    const payload = payment.invoice_payload;
    let durationMs = 0;

    if (payload.startsWith("premium_day_")) {
      durationMs = 1 * 24 * 60 * 60 * 1000;
    } else if (payload.startsWith("premium_week_")) {
      durationMs = 7 * 24 * 60 * 60 * 1000;
    } else if (payload.startsWith("premium_month_")) {
      durationMs = 30 * 24 * 60 * 60 * 1000;
    }

    if (!durationMs) {
      console.error("Unknown premium payment payload:", payload);
      return ctx.reply("Payment received, but the subscription could not be identified. Please contact support.");
    }

    const user = await User.findOne({ telegramId: tId });
    if (!user) {
      return ctx.reply("Payment received, but your account could not be found. Please contact support.");
    }

    const now = Date.now();
    const currentExpiry = user.premiumExpiresAt && user.premiumExpiresAt.getTime() > now
      ? user.premiumExpiresAt.getTime()
      : now;

    user.isPremium = true;
    user.premiumExpiresAt = new Date(currentExpiry + durationMs);
    await user.save();

    ctx.reply(
      `⭐ Payment Successful!\n\n` +
      `Premium activated successfully.\n` +
      `Expires: ${user.premiumExpiresAt.toLocaleString("en-IN")}`,
      mainMenuKeyboard
    ).catch(() => {});
  } catch (err) {
    console.error("Post-payment record sync failure:", err);
    ctx.reply("Payment received, but there was an error updating your account. Please contact support.").catch(() => {});
  }
});

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

    if (!state || state.step !== "AWAITING_GENDER") {
      return ctx.reply("Session expired. Type /start.").catch(() => {});
    }

    const systemGeneratedUserId = `usr_${Math.random().toString(36).substr(2, 9)}_${Date.now()}`;
    let newReferralCode = generateReferralCode();
    while (await User.exists({ referralCode: newReferralCode })) {
      newReferralCode = generateReferralCode();
    }

    await User.findOneAndUpdate(
      { telegramId: userId },
      {
        userId: systemGeneratedUserId,
        username: ctx.chat.username || "",
        name: state.name,
        age: state.age,
        gender: selectedGender,
        referralCode: newReferralCode,
        referredBy: state.referredBy || null
      },
      { upsert: true, new: true }
    );

    if (state.referredBy && state.referredBy !== userId) {
      const referredUser = await User.findOne({ telegramId: state.referredBy });
      if (referredUser) {
        referredUser.referralCount = (referredUser.referralCount || 0) + 1;
        const now = Date.now();
        const currentExpiry = referredUser.premiumExpiresAt && referredUser.premiumExpiresAt.getTime() > now
          ? referredUser.premiumExpiresAt.getTime()
          : now;

        referredUser.isPremium = true;
        referredUser.premiumExpiresAt = new Date(currentExpiry + 60 * 60 * 1000);
        await referredUser.save();

        ctx.telegram.sendMessage(
          referredUser.telegramId,
          `🎉 Hurray!\n\n` +
          `You earned ⭐ 1 hour of Premium for referring a new user!\n\n` +
          `Premium expires: ${referredUser.premiumExpiresAt.toLocaleString("en-IN")}`
        ).catch(() => {});
      }
    }

    userRegistrationStates.delete(userId);
    ctx.reply(
      `Profile saved successfully!\nName: ${state.name}\nAge: ${state.age}\nGender: ${selectedGender}\n\nUse /search or the menu to begin!`,
      mainMenuKeyboard
    ).catch(() => {});
  } catch (err) {
    console.error(err);
    ctx.reply("Error processing gender update. Please use /profile or /start to retry.").catch(() => {});
  }
});

bot.on("message", async (ctx) => {
  const userId = ctx.chat.id;
  const regState = userRegistrationStates.get(userId);

  if (regState) {
    const textInput = ctx.message.text ? ctx.message.text.trim() : "";

    if (regState.step === "AWAITING_NAME") {
      if (!textInput) return ctx.reply("Please input a valid text name.");
      userRegistrationStates.set(userId, {
        step: "AWAITING_AGE",
        name: textInput,
        referredBy: regState.referredBy || null
      });
      return ctx.reply("Excellent! Now, please type your age:");
    }

    if (regState.step === "AWAITING_AGE") {
      const parsedAge = parseInt(textInput, 10);
      if (isNaN(parsedAge) || parsedAge <= 0 || parsedAge > 120) {
        return ctx.reply("Please enter a valid numeric age value (e.g., 21):");
      }
      userRegistrationStates.set(userId, {
        step: "AWAITING_GENDER",
        name: regState.name,
        age: parsedAge,
        referredBy: regState.referredBy || null
      });
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
    ctx.reply("You are not in a chat!\n/search - use this to search for a new partner.", mainMenuKeyboard).catch(() => {});
  }
});

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

app.use(express.json());
app.get("/", (req, res) => res.send("Bot status: Operational."));
app.get("/ping", (req, res) => res.send("pong"));

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
      console.error(
        "[Telegraf Startup Error Handled]: Failed to initiate long-polling connection:",
        err.message || err
      );
    });
  }
});