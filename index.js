// Replace with your actual bot token from @BotFather
const BOT_TOKEN = '8007258891:AAFVZLpTUc8HfXqaBCHDh92RY_D91SG_5bY';

const TelegramBot = require('node-telegram-bot-api');
const { setUsersData } = require('./webapp');

// Start the webapp server
require('./webapp');

// Create a bot instance with better error handling
const bot = new TelegramBot(BOT_TOKEN, { 
  polling: {
    interval: 1000,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

// In-memory user database (in production, use a real database)
const users = new Map();
const userSessions = new Map(); // Track user sessions to prevent duplicates

// Share users data with webapp
setUsersData(users);

// Bot configuration (will be updated from admin panel)
let CONFIG = {
  adReward: 8, // hix per ad
  dailyAdLimit: 105,
  referralBonus: 0.010000, // USD for referrals
  referralBonusHix: 50, // hix for referrals
  dailyReward: () => Math.floor(Math.random() * 41) + 10, // 10-50 hix for daily reward
  minWithdrawal: {
    TON: 0.100000,
    TRX: 0.500000,
    USDT: 5.000000,
    FLEXY: 0.400000
  },
  coinToUsdRate: 0.0001 // 1 hix = 0.0001 USD (8 hix = 0.0008$)
};

// Function to get updated config from webapp
function getConfig() {
  try {
    const { getBotConfig } = require('./webapp');
    if (getBotConfig) {
      CONFIG = { ...CONFIG, ...getBotConfig() };
    }
  } catch (error) {
    // Use default config if webapp not available
  }
  return CONFIG;
}

// Initialize user data
function initUser(userId) {
  const userIdStr = userId.toString();
  if (!users.has(userIdStr)) {
    users.set(userIdStr, {
      userId: userIdStr,
      telegramId: userIdStr,
      balance: 0, // USD balance
      coins: 0, // hix balance
      adsWatched: { method1: 0 },
      lastAdReset: new Date().toDateString(),
      lastDailyReward: null,
      referrals: [],
      totalEarnings: 0,
      username: `User${userIdStr.slice(-4)}`, // Fallback display name
      referredBy: null
    });
  }
  return users.get(userIdStr);
}

// Reset daily ad limits
function checkDailyReset(user) {
  const today = new Date().toDateString();
  if (user.lastAdReset !== today) {
    user.adsWatched = { method1: 0 };
    user.lastAdReset = today;
  }
}

// Check if daily reward is available
function isDailyRewardAvailable(user) {
  const today = new Date().toDateString();
  return user.lastDailyReward !== today;
}

// Main menu keyboard
function getMainMenuKeyboard(user) {
  checkDailyReset(user);
  const webAppUrl = `https://sajhall.com?tgWebAppStartParam=ref_${user ? user.userId || '' : ''}`;

  return {
    inline_keyboard: [
      [
        { text: 'Earn Now 💰', web_app: { url: webAppUrl } }
      ]
    ]
  };
}

// Start command
bot.onText(/\/start$/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const displayName = msg.from.first_name || 
                     msg.from.last_name || 
                     msg.from.username || 
                     `User${userId.slice(-4)}`;

  const user = initUser(userId);
  user.username = displayName;

  const welcomeMessage = `🤖 *Welcome to WatchEarnBot!*

💰 Earn money by watching ads and inviting friends!

Choose an option below to get started:`;

  bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard(user)
  });
});

// Handle callback queries
bot.on('callback_query', (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const userId = callbackQuery.from.id.toString();
  const displayName = callbackQuery.from.first_name || 
                     callbackQuery.from.last_name || 
                     callbackQuery.from.username || 
                     `User${userId.slice(-4)}`;
  const data = callbackQuery.data;

  // Update user session for smart tracking
  const sessionKey = `${userId}_${chatId}`;
  userSessions.set(sessionKey, {
    lastInteraction: Date.now(),
    lastMessageType: 'callback'
  });

  const user = initUser(userId);
  user.username = displayName;
  checkDailyReset(user);

  if (data === 'main_menu') {
    const welcomeMessage = `🤖 *Welcome to WatchEarnBot!*

💰 Earn money by watching ads and inviting friends!

Choose an option below to get started:`;

    bot.editMessageText(welcomeMessage, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(user)
    });

  } else if (data === 'invite_menu') {
    const inviteMessage = `
🎁 *Invite Friends & Earn!*

1️⃣ Share your referral link
2️⃣ Friends join through your link  
3️⃣ They watch their first ad
4️⃣ You earn $${CONFIG.referralBonus} USD!

*Your Stats:*
👥 Total Referrals: ${user.referrals.length}
💰 Referral Earnings: $${(user.referrals.length * CONFIG.referralBonus).toFixed(6)} USD

Get your referral link below:
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🔗 Get Referral Link', callback_data: 'get_referral_link' }],
        [{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]
      ]
    };

    bot.editMessageText(inviteMessage, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

  } else if (data === 'get_referral_link') {
    const referralLink = `https://t.me/EarnForWatch_bot/webapp?start=ref_${userId}`;
    const webAppUrl = `https://sajhall.com?start=ref_${userId}`;

    const linkMessage = `
🔗 *Your Referral Link:*

\`${referralLink}\`

📋 *Tap to copy the link above*

Share this link with friends to start earning!
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🚀 Open WebApp', web_app: { url: webAppUrl } }],
        [{ text: '🔄 Generate New Link', callback_data: 'get_referral_link' }],
        [{ text: '⬅️ Back', callback_data: 'invite_menu' }]
      ]
    };

    bot.editMessageText(linkMessage, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });



  } else if (data === 'referrals_menu') {
    const referralsMessage = `
👥 *Referrals*

📊 *Your Stats:*
${user.referrals.length}        $${(user.referrals.length * CONFIG.referralBonus).toFixed(6)} USD
Total Referrals        Earnings

💡 *How it works:*
• Share your referral link
• Friends join and watch first ad
• You earn $${CONFIG.referralBonus} USD per referral
    `;

    const keyboard = {
      inline_keyboard: [
        [{ text: '📋 Copy Referral Link', callback_data: 'get_referral_link' }],
        [{ text: '⬅️ Back to Menu', callback_data: 'main_menu' }]
      ]
    };

    bot.editMessageText(referralsMessage, {
      chat_id: chatId,
      message_id: msg.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });

  }
});

// Handle referral system
bot.onText(/\/start ref_(\d+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const referrerId = match[1];
  const displayName = msg.from.first_name || 
                     msg.from.last_name || 
                     msg.from.username || 
                     `User${userId.slice(-4)}`;

  // Smart session tracking for referral messages
  const sessionKey = `${userId}_${chatId}`;
  const userSession = userSessions.get(sessionKey);
  const now = Date.now();
  
  if (userSession && (now - userSession.lastInteraction) < 30000) {
    return;
  }

  if (userId === referrerId) {
    userSessions.set(sessionKey, {
      lastInteraction: now,
      lastMessageType: 'error'
    });
    bot.sendMessage(chatId, "❌ You cannot refer yourself!");
    return;
  }

  const user = initUser(userId);
  user.username = displayName;
  const referrer = users.get(referrerId);

  if (referrer && !referrer.referrals.some(ref => ref.userId === userId)) {
    // Mark user as pending referral (will be rewarded after first ad)
    user.referredBy = referrerId;
    user.isPendingReferral = true;

    const welcomeMessage = `🎉 *Welcome to WatchEarnBot!*

You've been referred by a friend!

💰 Start watching ads to earn hix!

Your friend will receive $0.010000 USD when you watch your first ad.`;

    bot.sendMessage(chatId, welcomeMessage, { 
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(user)
    }).then(() => {
      userSessions.set(sessionKey, {
        lastInteraction: now,
        lastMessageType: 'referral_welcome'
      });
    });
  } else {
    const welcomeMessage = `🎉 *Welcome to WatchEarnBot!*

You've been referred by a friend!

💰 Start watching ads to earn hix!

Your friend will receive $0.010000 USD when you watch your first ad.`;

    bot.sendMessage(chatId, welcomeMessage, { 
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard(user)
    }).then(() => {
      userSessions.set(sessionKey, {
        lastInteraction: now,
        lastMessageType: 'referral_welcome'
      });
    });
  }
});

// Function to process pending referral when user watches first ad
function processPendingReferral(user) {
  if (user.isPendingReferral && user.referredBy) {
    const referrer = users.get(user.referredBy);
    if (referrer) {
      const config = getConfig();
      
      // Add to referrer's referral list with complete info
      referrer.referrals.push({
        userId: user.userId,
        username: user.username,
        joinDate: new Date().toISOString(),
        earnedDate: new Date().toISOString()
      });
      
      referrer.balance += config.referralBonus;
      referrer.totalEarnings += config.referralBonus;
      
      // Send notification to referrer with real username
      const referrerDisplayName = referrer.username || `User${referrer.userId.slice(-4)}`;
      bot.sendMessage(referrer.userId, `🎉 *Referral Reward Earned!*\n\n${user.username} watched their first ad!\nYou earned: $${config.referralBonus.toFixed(6)} USD\n\nTotal referrals: ${referrer.referrals.length}`, { parse_mode: 'Markdown' });
      
      // Mark as processed
      user.isPendingReferral = false;
      
      console.log(`Referral processed: ${user.username} (${user.userId}) -> ${referrerDisplayName} (${referrer.userId}) earned $${config.referralBonus}`);
    }
  }
}



// Help command
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const user = initUser(userId);

  const helpMessage = `
🤖 *WatchEarnBot Help*

💰 *How to Earn:*
• Watch ads (${CONFIG.adReward} hix per ad)
• Claim daily rewards (10-50 hix)
• Invite friends ($${CONFIG.referralBonus} + ${CONFIG.referralBonusHix} hix per referral)

📺 *Ad Watching:*
• 105 ads per day per method
• Must watch until the end
• Limits reset daily at 00:00

💸 *Withdrawals:*
• TON: min $${CONFIG.minWithdrawal.TON}
• TRX: min $${CONFIG.minWithdrawal.TRX}
• USDT: min $${CONFIG.minWithdrawal.USDT}
• FLEXY: min $${CONFIG.minWithdrawal.FLEXY} (Algeria only)

📞 *Support:* @iw_10
  `;

  bot.sendMessage(chatId, helpMessage, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard(user)
  });
});

// Error handling
bot.on('polling_error', (error) => {
  console.log('Polling error:', error.message);
  // Don't crash the bot on polling errors
});

bot.on('error', (error) => {
  console.log('Bot error:', error.message);
});

console.log('🤖 WatchEarnBot is running...');

function getBotConfig() {
  return CONFIG;
}

function updateBotConfig(newConfig) {
  CONFIG = { ...CONFIG, ...newConfig };
  console.log('Bot config updated:', CONFIG);
}

// Function to send referral notification
function sendReferralNotification(referrerId, newUserName, bonusAmount, bonusHix, totalReferrals) {
  try {
    bot.sendMessage(referrerId, `🎉 *Referral Reward Earned!*\n\n${newUserName} watched their first ad!\nYou earned: $${bonusAmount.toFixed(6)} USD\n\nTotal referrals: ${totalReferrals}`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.log('Error sending referral notification:', error.message);
  }
}

// Function to send broadcast message to all users
function sendBroadcastMessage(message, usersList) {
  let sentCount = 0;
  
  usersList.forEach(user => {
    try {
      bot.sendMessage(user.userId, message, { parse_mode: 'Markdown' });
      sentCount++;
    } catch (error) {
      console.log(`Failed to send broadcast to user ${user.userId}:`, error.message);
    }
  });
  
  console.log(`Broadcast message sent to ${sentCount} users`);
  return sentCount;
}

module.exports = { setUsersData, getBotConfig, updateBotConfig, sendReferralNotification, sendBroadcastMessage };