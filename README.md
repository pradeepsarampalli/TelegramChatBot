# Anonymous Random Chat Telegram Bot

A Telegram-based anonymous/random chat bot built with **Node.js, Telegraf, MongoDB, Mongoose, Express.js, and Telegram Stars**.

The bot allows users to create a profile and anonymously connect with random users. Premium users can access additional functionality such as gender-based matching. The application also includes referrals, premium subscriptions, user profile management, rate limiting, and production webhook support.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Features](#features)
3. [Technology Stack](#technology-stack)
4. [Application Architecture](#application-architecture)
5. [Database Structure](#database-structure)
6. [In-Memory Data Structures](#in-memory-data-structures)
7. [User Registration Flow](#user-registration-flow)
8. [Normal Random Search Flow](#normal-random-search-flow)
9. [Search by Gender Flow](#search-by-gender-flow)
10. [Chat Flow](#chat-flow)
11. [Stop and Next Flow](#stop-and-next-flow)
12. [Profile Management](#profile-management)
13. [Premium System](#premium-system)
14. [Premium Expiry](#premium-expiry)
15. [Telegram Stars Payment Flow](#telegram-stars-payment-flow)
16. [Referral System](#referral-system)
17. [Rate Limiting](#rate-limiting)
18. [Error Handling](#error-handling)
19. [Express Server](#express-server)
20. [Webhook and Local Development](#webhook-and-local-development)
21. [Function-by-Function Explanation](#function-by-function-explanation)
22. [Complete Application Flow](#complete-application-flow)
23. [Important Design Decisions](#important-design-decisions)
24. [Environment Variables](#environment-variables)
25. [Future Improvements](#future-improvements)

---

# Project Overview

The application is an anonymous/random chat bot for Telegram.

Users first create a profile containing:

- Name
- Age
- Gender
- Telegram username

After registration, users can search for another person.

The bot provides two major matching modes:

### Normal Search

Normal users use:

```text
🔍 Search
```

The search is completely random.

The user is placed into a common:

```js
activeUsers.any
```

queue.

No gender preference is considered in normal search.

### Premium Gender Search

Premium users can use:

```text
👫 Search by Gender
```

They can select the gender they want to search for.

The selected gender is then used to search the appropriate gender queue.

---

# Features

## 1. Telegram Bot

The application is built using Telegraf.

Users interact with the bot using:

- `/start`
- `/profile`
- `/search`
- `/next`
- `/stop`
- `/link`
- `/pay`
- `/terms`
- `/help`

The bot also provides Telegram keyboard buttons for common actions.

---

## 2. User Registration

New users are asked to provide:

1. Name
2. Age
3. Gender

After registration, the profile is stored in MongoDB.

---

## 3. Random Anonymous Matching

Users can search for random chat partners.

Normal search uses the common:

```js
activeUsers.any
```

queue.

The first available user is selected using:

```js
shift()
```

Therefore, the queue follows FIFO behavior.

Example:

```text
User A
User B
User C
```

If User D searches:

```text
User D → User A
```

User A is removed from the queue.

---

# 4. Gender-Based Matching

Premium users can select a preferred gender.

Example:

```text
👫 Search by Gender

Male
Female
Other
```

The application maintains:

```js
activeUsers.Male
activeUsers.Female
activeUsers.Other
activeUsers.any
```

---

# 5. Premium System

Premium users receive additional functionality.

Premium features include:

- Gender-based searching
- Advertisement-free experience
- Premium subscription access

Premium can be purchased using Telegram Stars.

---

# 6. Telegram Stars Payments

The planned subscription options are:

```text
1 Day    ⭐ 49
1 Week   ⭐ 99
1 Month  ⭐ 299
```

The selected plan is encoded inside the invoice payload.

Example:

```text
premium_day_<telegramId>_<timestamp>
```

This allows the successful payment handler to determine which subscription was purchased.

---

# 7. Premium Expiry

Premium access is time-based.

The database stores:

```js
premiumExpiresAt
```

The bot uses lazy expiration.

This means there is no background job constantly checking every user's subscription.

Instead, whenever a premium feature is requested, the bot checks whether the premium expiry date has passed.

---

# 8. Referral System

Each registered user can receive a unique referral link.

Example:

```text
https://t.me/BotUsername?start=ref_ABC123
```

When another person joins using the referral link:

```text
Referrer
   |
   | referral link
   v
New User
   |
   | completes registration
   v
Referral confirmed
```

The referrer receives:

```text
1 hour premium
```

The referral count is also incremented.

---

# 9. Profile Management

Users can view their profile using:

```text
/profile
```

The profile can contain:

- Name
- Age
- Gender
- Username
- Premium status
- Referral information

Users can also edit profile information through the provided buttons.

---

# 10. Share Telegram Username

The `/link` command allows a user who is currently chatting with another user to share their Telegram username.

The bot checks whether the user has a public username.

If available, the username is sent to the current partner.

---

# 11. Rate Limiting

The bot uses:

```text
telegraf-ratelimit
```

Current configuration:

```js
window: 2000
limit: 5
```

This limits excessive requests and helps prevent spam and abuse.

---

# Technology Stack

## Backend

- Node.js
- Express.js

## Telegram

- Telegraf

## Database

- MongoDB Atlas
- Mongoose

## Payments

- Telegram Stars

## Configuration

- dotenv

## Deployment

- Render or another Node.js hosting platform
- Telegram Webhooks in production

---

# Application Architecture

```text
                    Telegram User
                          |
                          v
                    Telegram Bot
                          |
                       Telegraf
                          |
          +---------------+---------------+
          |               |               |
          v               v               v
      Commands        Messages       Callbacks
          |               |               |
          +---------------+---------------+
                          |
                          v
                  Application Logic
                          |
          +---------------+---------------+
          |               |               |
          v               v               v
      Matching        Premium         Referral
          |               |               |
          +---------------+---------------+
                          |
                          v
                       MongoDB
```

Express is used to expose the HTTP server and production webhook.

---

# Database Structure

The main MongoDB collection is:

```text
users
```

The Mongoose model is:

```js
const User = mongoose.model("User", userSchema);
```

## User Schema

Important fields include:

```text
telegramId
userId
username
name
gender
age
isPremium
premiumExpiresAt
referralCode
referredBy
referralCount
registeredAt
```

### telegramId

The Telegram user ID.

It uniquely identifies a Telegram user.

### userId

An internal application user ID.

It is configured with `select: false`, so it is excluded from normal Mongoose queries.

### username

Stores the user's Telegram username.

### name

Stores the user's chosen name.

### gender

Allowed values:

```text
Male
Female
Other
```

### age

Stores the user's age.

### isPremium

Boolean indicating whether premium access is enabled.

### premiumExpiresAt

Stores when premium access expires.

### referralCode

Unique referral identifier for the user.

### referredBy

Stores the Telegram ID of the person who referred the user.

### referralCount

Number of successfully registered referrals.

### registeredAt

Stores the date on which the user registered.

---

# In-Memory Data Structures

The application uses JavaScript `Map` objects and arrays for real-time matching.

## userRegistrationStates

```js
const userRegistrationStates = new Map();
```

Stores the current registration/editing state of users.

Example:

```js
userRegistrationStates.set(userId, {
    step: "AWAITING_AGE",
    name: "John"
});
```

Possible states include:

```text
AWAITING_NAME
AWAITING_AGE
AWAITING_GENDER
EDITING_NAME
EDITING_AGE
```

---

## pairedPartners

```js
const pairedPartners = new Map();
```

Stores currently connected users.

Example:

```text
User A → User B
User B → User A
```

This makes it easy to forward messages.

---

## activeUsers

```js
const activeUsers = {
    Male: [],
    Female: [],
    Other: [],
    any: []
};
```

These arrays represent users waiting for a partner.

### any

Used by normal random search.

### Male

Used by gender-based matching.

### Female

Used by gender-based matching.

### Other

Used by gender-based matching.

---

# User Registration Flow

```text
User sends /start
       |
       v
Check MongoDB
       |
   +---+---+
   |       |
Exists   New user
   |       |
   |       v
   |   Ask name
   |       |
   |       v
   |   Ask age
   |       |
   |       v
   |  Ask gender
   |       |
   |       v
   |  Save profile
   |       |
   +-------+
       |
       v
   Main Menu
```

## Step 1: /start

The bot checks whether the Telegram ID already exists in MongoDB.

If the user exists, the bot welcomes them back.

If the user does not exist, registration begins.

## Step 2: Name

The user's name is temporarily stored in `userRegistrationStates`.

## Step 3: Age

The user enters their age.

The bot validates that the value is numeric and within the accepted range.

## Step 4: Gender

The bot displays gender selection buttons.

The selected gender is processed using a callback handler.

## Step 5: Save User

After gender selection, the profile is stored in MongoDB.

A referral code is also generated.

If the user came through a referral link, `referredBy` is stored.

---

# Normal Random Search Flow

Normal search is completely random.

```text
User presses Search
        |
        v
Check registration
        |
        v
Check existing connection
        |
        v
Check whether already searching
        |
        v
Check activeUsers.any
        |
   +----+----+
   |         |
Found      Empty
   |         |
   v         v
Connect    Add user
```

The important rule is:

> Normal search only uses `activeUsers.any`.

It does not use `targetGender`.

It does not inspect the user's gender.

Example:

```js
const partnerId = activeUsers.any.shift();
```

If no user is waiting:

```js
activeUsers.any.push(tId);
```

---

# Search by Gender Flow

Gender search is a premium feature.

```text
User presses Search by Gender
             |
             v
       Check profile
             |
             v
      Check premium
             |
             v
      Select Gender
             |
             v
      Search selected queue
             |
       +-----+-----+
       |           |
     Found        Empty
       |           |
       v           v
    Connect       Wait
```

The user can select a gender such as:

```text
Male
Female
Other
```

The selected gender determines the appropriate queue.

---

# Queue Cleanup

The application uses:

```js
initialQueueCleanup(tId)
```

This removes the user from all waiting queues:

```text
Male
Female
Other
any
```

This prevents the same user from accidentally appearing in multiple queues.

---

# Connecting Two Users

The connection process is handled by:

```js
connectUsers(ctx, userId, partnerId)
```

The function:

1. Removes both users from queues.
2. Creates the two-way partner relationship.
3. Notifies both users.

The relationship becomes:

```text
User A → User B
User B → User A
```

---

# Chat Message Flow

Once users are paired:

```text
User A
  |
  | message
  v
Telegram
  |
  v
Bot
  |
  v
pairedPartners
  |
  v
User B
```

The bot obtains the partner ID from `pairedPartners` and uses Telegram's `copyMessage()` to forward the message.

This allows multiple Telegram message types to be forwarded without manually recreating each message.

---

# Stop Flow

The user can execute:

```text
/stop
```

The bot:

1. Finds the current partner.
2. Notifies both users.
3. Removes both users from `pairedPartners`.

The conversation ends.

---

# Next Flow

The `/next` command means:

```text
Leave current partner
        +
Search for another partner
```

Flow:

```text
Current Chat
     |
     v
Disconnect partner
     |
     v
Cleanup queues
     |
     v
Start new search
```

---

# Stop Searching

While waiting in a queue, the user receives a `Stop Searching..` button.

If pressed, the bot calls:

```js
initialQueueCleanup(userId);
```

The user is removed from all search queues.

---

# Profile Flow

The `/profile` command retrieves the user's MongoDB document and displays information such as:

```text
Name
Age
Gender
Username
Premium status
Referral information
```

Profile editing uses temporary registration states similar to the initial registration process.

---

# Premium System

Premium access is controlled by:

```text
isPremium
premiumExpiresAt
```

The application should use:

```js
ensurePremiumActive(telegramId)
```

before granting premium-only functionality.

---

# Premium Expiry

The intended lazy expiry logic is:

```js
const ensurePremiumActive = async (telegramId) => {
    const user = await User.findOne({ telegramId });

    if (!user) return false;
    if (!user.isPremium) return false;

    if (
        user.premiumExpiresAt &&
        user.premiumExpiresAt.getTime() <= Date.now()
    ) {
        user.isPremium = false;
        user.premiumExpiresAt = null;

        await user.save();

        return false;
    }

    return true;
};
```

There is no need for a background timer for every user.

The expiry is checked when the user attempts to use a premium feature.

---

# Telegram Stars Payment Flow

The planned premium plans are:

```text
1 Day    ⭐ 49
1 Week   ⭐ 99
1 Month  ⭐ 299
```

Callback data:

```text
buy_day
buy_week
buy_month
```

The invoice payload contains the selected plan.

Example:

```text
premium_day_<telegramId>_<timestamp>
```

Payment flow:

```text
User selects plan
       |
       v
Create Stars invoice
       |
       v
Telegram checkout
       |
       v
pre_checkout_query
       |
       v
Approve checkout
       |
       v
successful_payment
       |
       v
Read payment payload
       |
       v
Determine duration
       |
       v
Update premiumExpiresAt
```

Durations:

```text
Day   → 24 hours
Week  → 7 days
Month → 30 days
```

If the user already has active premium, the new duration is added to the current expiry.

If premium has expired, the new subscription starts from the current time.

---

# Referral System

Each user gets a referral code and referral link.

Example:

```text
https://t.me/YourBot?start=ref_ABCD1234
```

When the new user starts the bot:

```text
Extract referral code
        |
        v
Find referrer
        |
        v
Validate referral
        |
        v
Store referredBy
        |
        v
Complete registration
        |
        v
Confirm referral
```

Self-referrals should be rejected.

After the referred user completes registration:

```text
referralCount += 1
```

and the referrer receives:

```text
+1 hour premium
```

If the referrer already has active premium, the extra hour extends the existing expiry.

---

# Rate Limiting

The application uses `telegraf-ratelimit`.

Current configuration:

```js
const limitConfig = {
    window: 2000,
    limit: 5
};
```

This means a user can make up to five requests in a two-second window.

The purpose is to reduce:

- Spam
- Abuse
- Excessive bot requests

---

# Error Handling

The application uses Telegraf's global error handler:

```js
bot.catch((err, ctx) => {
    console.error(...);
});
```

Individual operations also use `try/catch` blocks around database, Telegram, payment, and server operations.

This prevents many runtime errors from terminating the bot process.

---

# Express Server

The application creates an Express server:

```js
const app = express();
```

It exposes:

```text
GET /
GET /ping
```

## GET /

Returns:

```text
Bot status: Operational.
```

Useful for checking whether the server is running.

## GET /ping

Returns:

```text
pong
```

This is useful as a health-check or keep-alive endpoint.

---

# Webhook and Local Development

## Local Development

When the application is not running in production, it uses:

```js
bot.launch()
```

This starts Telegram long polling.

Architecture:

```text
Telegram
    |
    v
Long Polling
    |
    v
Node.js
```

---

## Production

In production, when `NODE_ENV=production` and `APP_URL` is configured, the application uses a Telegram webhook.

Architecture:

```text
Telegram
    |
    | HTTPS
    v
Express Server
    |
    v
Telegraf Webhook
    |
    v
Bot Logic
```

The webhook path is generated using Telegraf's secret path component.

---

# Function-by-Function Explanation

## mongoose.connect()

Connects the application to MongoDB.

Used for persistent user data.

---

## User Model

```js
const User = mongoose.model("User", userSchema);
```

Provides the interface for MongoDB operations such as:

```js
User.findOne()
User.findOneAndUpdate()
User.exists()
```

---

## bot.catch()

Global Telegraf error handler.

Logs errors that occur while processing Telegram updates.

---

## generateReferralCode()

Generates a unique referral code for a registered user.

---

## getReferralLink()

Creates the user's Telegram referral URL.

The resulting URL follows:

```text
https://t.me/<bot_username>?start=ref_<referral_code>
```

---

## ensurePremiumActive()

Checks whether premium access is currently valid.

Responsibilities:

- Find user.
- Check `isPremium`.
- Check `premiumExpiresAt`.
- Disable expired premium.
- Return the active premium state.

---

## initialQueueCleanup()

Removes a user from all matching queues.

Queues:

```text
Male
Female
Other
any
```

This is important before connecting users or starting another search.

---

## connectUsers()

Connects two Telegram users.

Responsibilities:

- Remove both users from queues.
- Create two-way partner mapping.
- Notify both users.

---

## handleSearch()

Main matching function.

Responsibilities include:

1. Validate the user's profile.
2. Synchronize username.
3. Check whether the user is already chatting.
4. Check whether the user is already searching.
5. Search the appropriate queue.
6. Connect users when a match is found.
7. Add the user to a queue when no match exists.

The `useGenderFilter` parameter determines whether the search is normal or gender-filtered.

---

## displayPayScreen()

Displays premium benefits and subscription options.

---

## sendStarsInvoice()

Creates a Telegram Stars invoice using the selected plan and amount.

---

## /start Handler

Responsible for:

- Detecting new users.
- Detecting existing users.
- Starting registration.
- Processing referral parameters.

---

## /profile Handler

Loads and displays the user's profile.

It also provides profile editing options.

---

## /search Handler

Starts normal random matching.

Conceptually:

```js
handleSearch(ctx, false);
```

---

## Search Button Handler

The `🔍 Search` keyboard button also starts normal random matching.

---

## Search by Gender Handler

The `👫 Search by Gender` button:

1. Checks whether the user has a profile.
2. Checks premium status.
3. Starts the gender-specific search flow.

---

## /next Handler

Disconnects the current partner and starts another search.

---

## /stop Handler

Ends the current conversation and clears the partner mapping.

---

## /link Handler

Shares the current user's Telegram username with the current partner.

---

## /pay Handler

Displays premium subscription options.

---

## /terms Handler

Displays the application's terms and rules.

---

## /help Handler

Displays available commands and basic bot instructions.

---

## Message Handler

The generic:

```js
bot.on("message", ...)
```

handler has two main responsibilities.

### Registration Mode

If the user is currently registering or editing their profile, the message is treated as profile input.

### Chat Mode

If the user is paired with someone, the message is copied to the partner.

Flow:

```text
Incoming message
       |
       v
Registration state exists?
       |
   +---+---+
   |       |
  Yes      No
   |       |
   v       v
Process   Check partner
input         |
              v
         Copy message
```

---

## Gender Callback Handler

Callbacks such as:

```text
gender_Male
gender_Female
gender_Other
```

are processed by the gender callback handler.

The selected gender is extracted from the callback data.

---

## pre_checkout_query Handler

Runs during Telegram Stars checkout.

It approves or rejects the payment before the transaction is completed.

---

## successful_payment Handler

Runs after Telegram confirms a successful payment.

The final implementation should:

1. Read the payment payload.
2. Identify the purchased plan.
3. Calculate the subscription duration.
4. Check the existing premium expiry.
5. Extend or start premium.
6. Save the updated premium information.

---

# Complete Application Flow

```text
                    Telegram User
                           |
                           v
                        /start
                           |
                           v
                  Is user registered?
                     /           \
                   No             Yes
                   |               |
                   v               v
              Registration      Main Menu
                   |
                   v
             Name → Age → Gender
                   |
                   v
              MongoDB User
                   |
                   v
                Main Menu
                   |
          +--------+--------+
          |                 |
          v                 v
       Search       Search by Gender
          |                 |
          |            Premium Check
          |                 |
          |                 v
          |          Select Gender
          |                 |
          |                 v
          |          Gender Queue
          |                 |
          +--------+--------+
                   |
                   v
              Find Partner
                   |
             +-----+-----+
             |           |
           Found        Not Found
             |           |
             v           v
          Connect      Add Queue
             |
             v
        Anonymous Chat
             |
        +----+----+
        |         |
      /stop      /next
        |         |
        v         v
      End      New Search
```

---

# Normal Search Architecture

```text
                Normal Search
                     |
                     v
              activeUsers.any
                     |
             +-------+-------+
             |               |
          Available       Empty
             |               |
             v               v
          shift()          push()
             |               |
             v               v
         Connect           Wait
```

Normal search does not use `targetGender`.

---

# Gender Search Architecture

```text
             Search by Gender
                    |
                    v
              Select Gender
                    |
       +------------+------------+
       |            |            |
      Male        Female       Other
       |            |            |
       v            v            v
   Male Queue   Female Queue  Other Queue
       |            |            |
       +------------+------------+
                    |
                    v
                  Match
```

---

# Premium Architecture

```text
                  Premium Request
                        |
                        v
                ensurePremiumActive()
                        |
                +-------+-------+
                |               |
              Active          Expired
                |               |
                v               v
             Allow          Disable
             feature        premium
```

---

# Referral Architecture

```text
Existing User
     |
     v
Generate Referral Code
     |
     v
Referral Link
     |
     v
New User opens link
     |
     v
/start ref_CODE
     |
     v
Store referredBy
     |
     v
Complete registration
     |
     +----------------+
     |                |
     v                v
Increment count    +1 hour premium
```

---

# Payment Architecture

```text
User
 |
 v
Premium Screen
 |
 v
Select Plan
 |
 v
Telegram Stars Invoice
 |
 v
Checkout
 |
 v
pre_checkout_query
 |
 v
Successful Payment
 |
 v
Read Payload
 |
 v
Calculate Duration
 |
 v
Update premiumExpiresAt
 |
 v
Premium Active
```

---

# Deployment Architecture

## Local

```text
Telegram
    |
    v
Long Polling
    |
    v
Node.js + Telegraf
    |
    +---- MongoDB
```

## Production

```text
Telegram
    |
    | HTTPS Webhook
    v
Express
    |
    v
Telegraf
    |
    +---- MongoDB
```

---

# Environment Variables

Example:

```env
Token=YOUR_TELEGRAM_BOT_TOKEN
MONGO_URI=YOUR_MONGODB_CONNECTION_STRING
APP_URL=https://your-domain.com
NODE_ENV=production
PORT=3000
```

Never commit secrets such as Telegram bot tokens, MongoDB credentials, or API keys to GitHub.

---

# Important Design Decisions

## 1. MongoDB Stores Permanent Data

MongoDB stores:

- User profile
- Premium state
- Premium expiry
- Referral information
- Registration date

---

## 2. Matching Queues Are In Memory

The active search queues are JavaScript arrays.

Therefore, they are reset if the Node.js process restarts.

MongoDB user profiles remain available.

---

## 3. Paired Users Are Stored In Memory

Current chat relationships are maintained using:

```js
pairedPartners
```

A server restart can therefore lose currently active chat pair relationships.

A future production implementation could use Redis for persistent/distributed session state.

---

## 4. Queue Cleanup Is Important

Before connecting users, the bot removes them from every possible queue.

This prevents the same user from being present in multiple queues simultaneously.

---

## 5. Normal Search Is Completely Random

Normal search only uses:

```js
activeUsers.any
```

It does not use:

```text
targetGender
Male
Female
Other
```

---

## 6. Premium Gender Search Is Separate

Gender-specific queues are used by the premium gender-search feature.

---

# Future Improvements

Possible improvements include:

- Redis-based matching queues
- Persistent chat sessions
- User reporting
- User blocking
- User banning
- Spam detection
- Duplicate partner prevention
- Age filtering
- Language filtering
- Country filtering
- Interest-based matching
- Online presence
- Admin dashboard
- Analytics
- Premium conversion tracking
- Referral analytics
- Match success metrics
- Chat duration analytics

---

# Summary

The application consists of five major systems:

```text
1. User Management
   |
   +-- Registration
   +-- Profile
   +-- Profile Editing

2. Matching
   |
   +-- Random Search
   +-- Gender Search
   +-- Queue Management
   +-- Partner Management

3. Premium
   |
   +-- Telegram Stars
   +-- Subscription Duration
   +-- Lazy Expiry
   +-- Premium Features

4. Referral
   |
   +-- Referral Codes
   +-- Referral Links
   +-- Referral Tracking
   +-- Premium Rewards

5. Infrastructure
   |
   +-- MongoDB
   +-- Express
   +-- Webhooks
   +-- Long Polling
   +-- Rate Limiting
   +-- Error Handling
```

The central application flow is:

```text
Telegram
   |
   v
Telegraf
   |
   v
User Registration
   |
   v
MongoDB
   |
   v
Search
   |
   +-------------------+
   |                   |
Normal Search     Premium Search
   |                   |
any Queue          Gender Queue
   |                   |
   +---------+---------+
             |
             v
         Match Users
             |
             v
        Anonymous Chat
             |
       +-----+-----+
       |           |
     /stop       /next
       |           |
       v           v
     End       New Search
```

The bot combines real-time anonymous matching, persistent user profiles, premium subscriptions, Telegram Stars payments, referral rewards, and production-ready Telegram webhook infrastructure in a single Node.js application.
