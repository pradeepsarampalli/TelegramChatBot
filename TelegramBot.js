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
  console.error(`[Telegraf Error] update_id: ${ctx?.update?.update_id}:`, err.message || err);
});

const limitConfig = {
  window: 2000,
  limit: 5,
  onLimitExceeded: (ctx) => ctx.reply("Please avoid spamming the bot!").catch(() => {})
};

bot.use(rateLimit(limitConfig));

const userRegistrationStates = new Map();
const pairedPartners = new Map();
const activeUsers = {
  Male: [],
  Female: [],
  Other: [],
  any: []
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

function generateReferralCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

const getReferralLink = async (telegramId) => {
  const user = await User.findOne({ telegramId });
  if (!user) return null;

  if (!user.referralCode) {
    let newCode = generateReferralCode();
    while (await User.exists({ referralCode: newCode })) {
      newCode = generateReferralCode();
    }
    user.referralCode = newCode;
    await user.save();
  }

  const botInfo = await bot.telegram.getMe();
  return `https://t.me/${botInfo.username}?start=ref_${user.referralCode}`;
};

const ensurePremiumActive = async (telegramId) => {
  const user = await User.findOne({ telegramId });
  if (!user) return false;
  if (!user.isPremium) return false;

  if (user.premiumExpiresAt && user.premiumExpiresAt.getTime() <= Date.now()) {
    user.isPremium = false;
    user.premiumExpiresAt = null;
    await user.save();
    return false;
  }

  return true;
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
        `Welcome back, ${existingUser.name}!\n\nUse /search to find a partner.`,
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

    await ctx.reply(
      "Welcome to the Anonymous Chat Bot!\n\n" +
      "Let's create your profile.\n\n" +
      "Please type your name:"
    );

    userRegistrationStates.set(tId, {
      step: "AWAITING_NAME",
      referredBy
    });
  } catch (err) {
    console.error("Start error:", err);
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
      `⭐ <b>Reward:</b> 1 hour Premium for every new user who completes registration through your link.\n\n` +
      `📣 Share your link with your friends and earn free Premium!`;

    return ctx.reply(referralText, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📤 Share My Link",
              url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}`
            }
          ],
          [
            {
              text: "📊 My Referral Stats",
              callback_data: "referral_stats"
            }
          ]
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
      `👥 <b>Total successful referrals:</b> ${profile.referralCount || 0}\n\n` +
      `✅ <b>Completed registrations:</b> ${referredUsers.length}\n\n` +
      `⭐ <b>Reward:</b> 1 hour Premium per successful referral.`;

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
    const updatedProfile = await User.findOne({ telegramId: tId });

    let premiumText = "Inactive";
    if (premiumActive && updatedProfile?.premiumExpiresAt) {
      premiumText = `Active\nExpires: ${updatedProfile.premiumExpiresAt.toLocaleString()}`;
    }

    const text =
      `👤 <b>Your Profile</b>\n\n` +
      `👤 Name: ${profile.name}\n` +
      `🎂 Age: ${profile.age}\n` +
      `⚥ Gender: ${profile.gender}\n` +
      `🌟 Premium: ${premiumText}\n` +
      `🎁 Referrals: ${profile.referralCount || 0}`;

    return ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "✏️ Edit Name", callback_data: "edit_name" }],
          [{ text: "✏️ Edit Age", callback_data: "edit_age" }],
          [{ text: "✏️ Edit Gender", callback_data: "edit_gender" }]
        ]
      }
    });
  } catch (err) {
    console.error("Profile error:", err);
    ctx.reply("An error occurred loading your profile.").catch(() => {});
  }
});

bot.action(/edit_(name|age|gender)/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const field = ctx.match[1];
  const tId = ctx.chat.id;

  await ctx.editMessageReplyMarkup(undefined).catch(() => {});

  if (field === "name") {
    await ctx.reply("Please enter your new name:");
    userRegistrationStates.set(tId, { step: "EDITING_NAME" });
  } else if (field === "age") {
    await ctx.reply("Please enter your new age:");
    userRegistrationStates.set(tId, { step: "EDITING_AGE" });
  } else if (field === "gender") {
    await ctx.reply("Select your new gender:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Male ♂️", callback_data: "gender_Male" }],
          [{ text: "Female ♀️", callback_data: "gender_Female" }],
          [{ text: "Other", callback_data: "gender_Other" }]
        ]
      }
    });
  }
});

bot.command("terms", (ctx) => {
  const termsText =
    `<b>Terms of Service</b>\n\n` +
    `1. Be respectful to your chat partners.\n` +
    `2. Do not share explicit media, spam, or scam links.\n` +
    `3. Do not harass or threaten other users.\n` +
    `4. Misuse of the service may result in account termination.`;

  ctx.reply(termsText, { parse_mode: "HTML" }).catch(() => {});
});

bot.command("help", (ctx) => {
  const helpText =
    `🤖 <b>Bot Help</b>\n\n` +
    `🚀 /start — Start bot\n` +
    `👤 /profile — View profile\n` +
    `🔍 /search — Find random partner\n` +
    `👫 Search by Gender — Premium gender search\n` +
    `⏭️ /next — Find next partner\n` +
    `🛑 /stop — End chat\n` +
    `🔗 /link — Share Telegram username\n` +
    `🎁 /refer — Refer & Earn\n` +
    `💎 /pay — Premium plans\n` +
    `📜 /terms — Terms & rules\n` +
    `❓ /help — Help`;

  ctx.reply(helpText, { parse_mode: "HTML" }).catch(() => {});
});

const displayPayScreen = (ctx) => {
  const infoText =
    `⭐ <b>Premium</b>\n\n` +
    `Premium benefits:\n\n` +
    `🚫 No ads\n` +
    `👫 Search by gender\n\n` +
    `Choose a Premium plan below.\n\n` +
    `🎁 You can also get <b>1 hour free Premium</b> for every new user you refer who completes registration.`;

  ctx.reply(infoText, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "1 Day ⭐ 49", callback_data: "buy_day" }],
        [{ text: "1 Week ⭐ 99", callback_data: "buy_week" }],
        [{ text: "1 Month ⭐ 299", callback_data: "buy_month" }],
        [{ text: "🎁 Get Free VIP", callback_data: "free_vip" }]
      ]
    }
  }).catch(() => {});
};

bot.command("pay", (ctx) => {
  displayPayScreen(ctx);
});

bot.action("free_vip", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  return sendReferralScreen(ctx);
});

function initialQueueCleanup(tId) {
  activeUsers.Male = activeUsers.Male.filter((id) => id !== tId);
  activeUsers.Female = activeUsers.Female.filter((id) => id !== tId);
  activeUsers.Other = activeUsers.Other.filter((id) => id !== tId);
  activeUsers.any = activeUsers.any.filter((id) => id !== tId);
}

async function connectUsers(ctx, userId, partnerId) {
  initialQueueCleanup(userId);
  initialQueueCleanup(partnerId);

  pairedPartners.set(userId, partnerId);
  pairedPartners.set(partnerId, userId);

  ctx.telegram.sendMessage(userId, "You are now connected to a partner!", {
    reply_markup: { remove_keyboard: true }
  }).catch(() => {});

  ctx.telegram.sendMessage(partnerId, "You are now connected to a partner!", {
    reply_markup: { remove_keyboard: true }
  }).catch(() => {});
}

async function handleSearch(ctx, useGenderFilter = false, selectedGender = null) {
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

    if (useGenderFilter) {
      const premiumActive = await ensurePremiumActive(tId);
      if (!premiumActive) {
        return displayPayScreen(ctx);
      }
      if (!selectedGender) {
        return ctx.reply("Please select a gender to search for.");
      }
    }

    await ctx.telegram.sendMessage(tId, "Searching for a partner..", {
      reply_markup: {
        keyboard: [[{ text: "Stop Searching.." }]],
        resize_keyboard: true
      }
    }).catch(() => {});

    if (useGenderFilter && selectedGender) {
      if (activeUsers[selectedGender].length > 0) {
        const partnerId = activeUsers[selectedGender].shift();
        await connectUsers(ctx, tId, partnerId);
        return;
      }
      activeUsers[userProfile.gender].push(tId);
      return;
    }

    if (activeUsers.any.length > 0) {
      const partnerId = activeUsers.any.shift();
      await connectUsers(ctx, tId, partnerId);
    } else {
      activeUsers.any.push(tId);
    }
  } catch (err) {
    console.error("Search error:", err);
    ctx.reply("Something went wrong while processing your search request.").catch(() => {});
  }
}

bot.command("search", (ctx) => handleSearch(ctx, false));
bot.hears("🔍 Search", (ctx) => handleSearch(ctx, false));

bot.hears("👫 Search by Gender", async (ctx) => {
  const tId = ctx.chat.id;

  try {
    const userProfile = await User.findOne({ telegramId: tId });
    if (!userProfile) {
      return ctx.reply("You must complete your profile first! Type /start to register.");
    }

    const premiumActive = await ensurePremiumActive(tId);
    if (!premiumActive) {
      return displayPayScreen(ctx);
    }

    return ctx.reply("Who do you want to chat with?", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "👨 Male", callback_data: "search_gender_Male" }],
          [{ text: "👩 Female", callback_data: "search_gender_Female" }],
          [{ text: "🧑 Other", callback_data: "search_gender_Other" }]
        ]
      }
    });
  } catch (err) {
    console.error("Gender search selection error:", err);
    ctx.reply("Unable to start gender search. Please try again.").catch(() => {});
  }
});

bot.action(/^search_gender_(Male|Female|Other)$/, async (ctx) => {
  const tId = ctx.chat.id;
  const selectedGender = ctx.match[1];

  await ctx.answerCbQuery().catch(() => {});

  try {
    const premiumActive = await ensurePremiumActive(tId);
    if (!premiumActive) {
      await ctx.editMessageReplyMarkup(undefined).catch(() => {});
      return displayPayScreen(ctx);
    }

    await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    return handleSearch(ctx, true, selectedGender);
  } catch (err) {
    console.error("Gender selection error:", err);
    ctx.reply("Something went wrong. Please try again.").catch(() => {});
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

  return handleSearch(ctx, false);
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
      "You left the chat!\n\nUse /search to find a new partner.",
      mainMenuKeyboard
    ).catch(() => {});

    ctx.telegram.sendMessage(
      partnerId,
      "Your partner left the chat!\n\nUse /search to find a new partner.",
      mainMenuKeyboard
    ).catch(() => {});

    pairedPartners.delete(partnerId);
    pairedPartners.delete(userId);
  } else {
    initialQueueCleanup(userId);
    ctx.reply(
      "You are not in a chat!\n\nUse /search to find a new partner.",
      mainMenuKeyboard
    ).catch(() => {});
  }
});

bot.command("link", (ctx) => {
  const userId = ctx.chat.id;
  const partnerId = pairedPartners.get(userId);

  if (!partnerId) {
    return ctx.reply("You are not in a chat!\n\nUse /search to find a partner.");
  }

  if (!ctx.chat.username) {
    return ctx.reply("Set a public Telegram username first in your Telegram profile.");
  }

  ctx.telegram.sendMessage(userId, "Your username has been sent to your partner!").catch(() => {});
  ctx.telegram.sendMessage(partnerId, `Your partner's username:\n@${ctx.chat.username}`).catch(() => {});
});

const sendStarsInvoice = async (ctx, plan, title, amount) => {
  try {
    const payload = `premium_${plan}_${ctx.chat.id}_${Date.now()}`;
    await ctx.replyWithInvoice({
      title,
      description: "Premium access with gender search and an ad-free experience.",
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: title, amount }]
    });
  } catch (err) {
    console.error("Invoice deployment failure:", err);
    ctx.reply("Unable to load checkout window. Please try again.").catch(() => {});
  }
};

bot.action("buy_day", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  return sendStarsInvoice(ctx, "day", "Premium - 1 Day", 49);
});

bot.action("buy_week", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  return sendStarsInvoice(ctx, "week", "Premium - 1 Week", 99);
});

bot.action("buy_month", async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  return sendStarsInvoice(ctx, "month", "Premium - 1 Month", 299);
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
    const payloadParts = payload.split("_");
    const plan = payloadParts[1];

    let durationMs;
    if (plan === "day") {
      durationMs = 1 * 24 * 60 * 60 * 1000;
    } else if (plan === "week") {
      durationMs = 7 * 24 * 60 * 60 * 1000;
    } else if (plan === "month") {
      durationMs = 30 * 24 * 60 * 60 * 1000;
    } else {
      console.error("Unknown premium plan:", plan);
      return ctx.reply(
        "Payment received, but the subscription plan could not be identified. Please contact support."
      );
    }

    const user = await User.findOne({ telegramId: tId });
    if (!user) {
      return ctx.reply(
        "Payment received, but your user account could not be found. Please contact support."
      );
    }

    const now = Date.now();
    let startTime = now;

    if (user.isPremium && user.premiumExpiresAt && user.premiumExpiresAt.getTime() > now) {
      startTime = user.premiumExpiresAt.getTime();
    }

    const newExpiry = new Date(startTime + durationMs);
    user.isPremium = true;
    user.premiumExpiresAt = newExpiry;
    await user.save();

    const planName = plan === "day" ? "1 Day" : plan === "week" ? "1 Week" : "1 Month";

    ctx.reply(
      `⭐ Payment Successful!\n\n` +
      `Premium plan: ${planName}\n` +
      `Premium expires: ${newExpiry.toLocaleString()}\n\n` +
      `Premium benefits are now active.`,
      mainMenuKeyboard
    ).catch(() => {});
  } catch (err) {
    console.error("Post-payment processing error:", err);
    ctx.reply(
      "Payment was received, but there was an error updating your premium status. Please contact support."
    ).catch(() => {});
  }
});

bot.action(/^gender_(Male|Female|Other)$/, async (ctx) => {
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
      return ctx.reply("Session expired. Type /start.");
    }

    const systemGeneratedUserId = `usr_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
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
        referredBy: state.referredBy || null,
        isPremium: false,
        premiumExpiresAt: null
      },
      { upsert: true, new: true }
    );

    if (state.referredBy && state.referredBy !== userId) {
      const referrer = await User.findOne({ telegramId: state.referredBy });

      if (referrer) {
        const now = Date.now();
        let rewardStart = now;

        if (
          referrer.isPremium &&
          referrer.premiumExpiresAt &&
          referrer.premiumExpiresAt.getTime() > now
        ) {
          rewardStart = referrer.premiumExpiresAt.getTime();
        }

        referrer.isPremium = true;
        referrer.premiumExpiresAt = new Date(rewardStart + 60 * 60 * 1000);
        referrer.referralCount = (referrer.referralCount || 0) + 1;
        await referrer.save();

        await ctx.telegram.sendMessage(
          referrer.telegramId,
          `🎉 <b>Hurray!</b>\n\n` +
          `You earned ⭐ <b>1 hour of Premium</b> for referring a new user!\n\n` +
          `Premium expires: ${referrer.premiumExpiresAt.toLocaleString()}`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }
    }

    userRegistrationStates.delete(userId);

    return ctx.reply(
      `✅ <b>Profile saved successfully!</b>\n\n` +
      `👤 Name: ${state.name}\n` +
      `🎂 Age: ${state.age}\n` +
      `⚥ Gender: ${selectedGender}\n\n` +
      `Use /search or the menu to find a partner.`,
      {
        parse_mode: "HTML",
        ...mainMenuKeyboard
      }
    );
  } catch (err) {
    console.error("Gender callback error:", err);
    ctx.reply("Error processing your profile. Please use /profile or /start to retry.").catch(() => {});
  }
});

bot.on("message", async (ctx) => {
  const userId = ctx.chat.id;
  const regState = userRegistrationStates.get(userId);

  if (regState) {
    const textInput = ctx.message.text ? ctx.message.text.trim() : "";

    if (regState.step === "AWAITING_NAME") {
      if (!textInput) {
        return ctx.reply("Please enter a valid name.");
      }
      userRegistrationStates.set(userId, {
        step: "AWAITING_AGE",
        name: textInput,
        referredBy: regState.referredBy || null
      });
      return ctx.reply("Excellent!\n\nNow, please type your age:");
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
            [{ text: "Female ♀️", callback_data: "gender_Female" }],
            [{ text: "Other", callback_data: "gender_Other" }]
          ]
        }
      });
    }

    if (regState.step === "EDITING_NAME") {
      if (!textInput) {
        return ctx.reply("Please input a valid name.");
      }
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
    ctx.reply(
      "You are not in a chat!\n\nUse /search to find a new partner.",
      mainMenuKeyboard
    ).catch(() => {});
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
      console.log("Production Webhook active!");
    } catch (err) {
      console.error("Webhook binding error:", err.message);
    }

    setInterval(() => {
      fetch(`${APP_URL}/ping`)
        .then(() => console.log("Keep-alive ping sent!"))
        .catch((err) => console.error("Keep-alive ping failed:", err.message));
    }, 5 * 60 * 1000);
  } else {
    console.log("Running locally in Long-Polling Mode.");
    bot.launch().catch((err) => {
      console.error("[Telegraf Startup Error]:", err.message || err);
    });
  }
});