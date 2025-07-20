const express = require('express');
const path = require('path');
const app = express();
const port = 5000;

let usersData = new Map();
let pendingWithdrawals = [];
let botConfig = {
  adReward: 8,
  dailyAdLimit: 105,
  referralBonus: 0.010000,
  coinToUsdRate: 0.0001,
  minWithdrawal: {
    TON: 0.100000,
    TRX: 0.500000,
    USDT: 5.000000,
    FLEXY: 0.400000
  }
};

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Share users data from bot
function setUsersData(users) {
  usersData = users;
}

// Function to sync config with bot
function syncConfigWithBot() {
  try {
    const botModule = require('./index');
    if (botModule && botModule.updateBotConfig) {
      botModule.updateBotConfig(botConfig);
    }
  } catch (error) {
    console.log('Bot config sync not available yet');
  }
}

// API Routes
app.post('/api/telegram-login', (req, res) => {
  const { initData, referralCode } = req.body;

  // Simple validation - in production, validate initData properly
  if (!initData) {
    return res.json({ success: false, message: 'Invalid Telegram data' });
  }

  // Parse Telegram initData to extract user info
  let telegramUser = {};
  try {
    const urlParams = new URLSearchParams(initData);
    const userParam = urlParams.get('user');
    if (userParam) {
      telegramUser = JSON.parse(decodeURIComponent(userParam));
    }
  } catch (error) {
    console.log('Error parsing Telegram data:', error);
    return res.json({ success: false, message: 'Invalid Telegram user data' });
  }

  if (!telegramUser.id) {
    return res.json({ success: false, message: 'Invalid Telegram user' });
  }

  const telegramId = telegramUser.id.toString();
  // Create display name with fallbacks
  const displayName = telegramUser.first_name || 
                     telegramUser.last_name || 
                     telegramUser.username || 
                     `User${telegramId.slice(-4)}`; // Use last 4 digits of ID as fallback
  const photoUrl = telegramUser.photo_url || null;

  console.log(`User login attempt - ID: ${telegramId}, Display name: ${displayName}`);

  // Check if user already exists using ID only
  let user = usersData.get(telegramId);
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    console.log(`Creating new user with ID: ${telegramId}`);
    // Create new user
    user = {
      userId: telegramId,
      telegramId: telegramId,
      username: displayName,
      photoUrl: photoUrl,
      balance: 0,
      coins: 0,
      adsWatched: { method1: 0 },
      lastAdReset: new Date().toDateString(),
      lastDailyReward: null,
      referrals: [],
      totalEarnings: 0,
      referredBy: null,
      hasWatchedFirstAd: false,
      isPendingReferral: false
    };

    // Handle referral for new users only - mark as pending until first ad
    if (referralCode && referralCode !== telegramId && usersData.has(referralCode)) {
      const referrer = usersData.get(referralCode);
      if (referrer) {
        // Initialize referrals array if it doesn't exist
        if (!referrer.referrals) referrer.referrals = [];
        
        // Check if this user is already referred (handle both old string format and new object format)
        const alreadyReferred = referrer.referrals.some(ref => 
          typeof ref === 'object' ? ref.userId === telegramId : ref === telegramId
        );
        
        if (!alreadyReferred) {
          console.log(`Marking referral as pending: ${telegramId} referred by ${referralCode}`);
          user.referredBy = referralCode;
          user.isPendingReferral = true;
          
          console.log(`User ${telegramId} (${displayName}) will reward referrer ${referralCode} after first ad watch`);
        }
      }
    }

    usersData.set(telegramId, user);
    console.log(`New user created and saved with ID: ${telegramId}`);
  } else {
    // Update existing user info but keep the same ID-based identification
    console.log(`Existing user found with ID: ${telegramId}`);
    user.username = displayName;
    if (photoUrl) {
      user.photoUrl = photoUrl;
    }
  }

  // Add current config to user data
  const userWithConfig = {
    ...user,
    dailyAdLimit: botConfig.dailyAdLimit,
    adReward: botConfig.adReward,
    referralBonus: botConfig.referralBonus,
    minWithdrawal: botConfig.minWithdrawal,
    coinToUsdRate: botConfig.coinToUsdRate
  };

  const message = isNewUser && user.referredBy ? 
    `Welcome! You were referred by a friend who earned $${botConfig.referralBonus.toFixed(6)}!` : 
    'Login successful';

  res.json({ success: true, user: userWithConfig, config: botConfig, message: message });
});

app.post('/api/daily-reward', (req, res) => {
  const { userId } = req.body;
  const user = usersData.get(userId);

  if (!user) {
    return res.json({ success: false, message: 'User not found' });
  }

  const today = new Date().toDateString();
  if (user.lastDailyReward === today) {
    return res.json({ success: false, message: 'Daily reward already claimed', user: user });
  }

  const dailyRewardAmount = Math.floor(Math.random() * 41) + 10; // 10-50 coins
  console.log('Daily reward amount generated:', dailyRewardAmount);
  user.coins += dailyRewardAmount;
  user.balance += dailyRewardAmount * botConfig.coinToUsdRate;
  user.totalEarnings += dailyRewardAmount * botConfig.coinToUsdRate;
  user.lastDailyReward = today;

  // Add current config to user data
  const userWithConfig = {
    ...user,
    dailyAdLimit: botConfig.dailyAdLimit,
    adReward: botConfig.adReward,
    referralBonus: botConfig.referralBonus,
    minWithdrawal: botConfig.minWithdrawal,
    coinToUsdRate: botConfig.coinToUsdRate
  };

  res.json({ success: true, user: userWithConfig, earnedCoins: dailyRewardAmount, config: botConfig });
});

app.post('/api/watch-ad', (req, res) => {
  const { userId, method, watchTime, tabChanges } = req.body;
  const user = usersData.get(userId);

  if (!user) {
    return res.json({ success: false, message: 'User not found' });
  }

  // Anti-cheat validations
  if (watchTime < 14000) {
    return res.json({ success: false, message: 'Invalid watch time detected' });
  }

  if (tabChanges >= 3) {
    return res.json({ success: false, message: 'Too many tab changes detected' });
  }

  // Check daily reset
  const today = new Date().toDateString();
  if (user.lastAdReset !== today) {
    user.adsWatched = { method1: 0 };
    user.lastAdReset = today;
  }

  if (user.adsWatched[method] >= botConfig.dailyAdLimit) {
    return res.json({ success: false, message: 'Daily limit reached' });
  }

  // Check if this is user's first ad ever
  const isFirstAdEver = !user.hasWatchedFirstAd;
  
  user.adsWatched[method]++;
  user.coins += botConfig.adReward;
  user.balance += botConfig.adReward * botConfig.coinToUsdRate;
  user.totalEarnings += botConfig.adReward * botConfig.coinToUsdRate;
  user.hasWatchedFirstAd = true;

  // Process pending referral if this is the first ad
  if (isFirstAdEver && user.isPendingReferral && user.referredBy) {
    const referrer = usersData.get(user.referredBy);
    if (referrer) {
      // Add to referrer's referral list with complete info
      if (!referrer.referrals) referrer.referrals = [];
      
      // Check if this referral is already processed
      const alreadyExists = referrer.referrals.some(ref => 
        typeof ref === 'object' ? ref.userId === userId : ref === userId
      );
      
      if (!alreadyExists) {
        referrer.referrals.push({
          userId: userId,
          username: user.username,
          joinDate: new Date().toISOString(),
          earnedDate: new Date().toISOString()
        });
        
        referrer.balance += botConfig.referralBonus;
        referrer.totalEarnings += botConfig.referralBonus;
        
        // Mark as processed
        user.isPendingReferral = false;
        
        console.log(`Referral processed via webapp: ${user.username} (${userId}) -> ${referrer.username} (${referrer.userId}) earned $${botConfig.referralBonus}`);
        
        // Try to notify referrer via Telegram
        try {
          const botModule = require('./index');
          if (botModule && botModule.sendReferralNotification) {
            botModule.sendReferralNotification(referrer.userId, user.username, botConfig.referralBonus, 0, referrer.referrals.length);
          }
        } catch (error) {
          console.log('Could not send Telegram notification:', error.message);
        }
      }
    }
  }

  console.log(`User ${user.username} (${userId}) watched ad ${method}. Watch time: ${watchTime}ms, Tab changes: ${tabChanges}. Earned: ${botConfig.adReward} hix`);

  // Add current config to user data
  const userWithConfig = {
    ...user,
    dailyAdLimit: botConfig.dailyAdLimit,
    adReward: botConfig.adReward,
    referralBonus: botConfig.referralBonus,
    minWithdrawal: botConfig.minWithdrawal,
    coinToUsdRate: botConfig.coinToUsdRate
  };

  res.json({ success: true, user: userWithConfig, earnedCoins: botConfig.adReward, config: botConfig });
});

app.post('/api/withdraw', (req, res) => {
  const { userId, currency, binanceId, phoneNumber } = req.body;
  const user = usersData.get(userId);

  if (!user) {
    return res.json({ success: false, message: 'User not found' });
  }

  // Check daily withdrawal limit
  const today = new Date().toDateString();
  if (!user.withdrawalHistory) {
    user.withdrawalHistory = [];
  }

  const todayWithdrawals = user.withdrawalHistory.filter(w => 
    new Date(w.date).toDateString() === today
  );

  if (todayWithdrawals.length > 0) {
    // Calculate time remaining until next withdrawal
    const lastWithdrawal = todayWithdrawals[0];
    const lastWithdrawalDate = new Date(lastWithdrawal.date);
    const nextWithdrawalTime = new Date(lastWithdrawalDate);
    nextWithdrawalTime.setDate(nextWithdrawalTime.getDate() + 1);
    
    const now = new Date();
    const timeRemaining = nextWithdrawalTime - now;
    
    if (timeRemaining > 0) {
      const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
      const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
      
      return res.json({ 
        success: false, 
        message: `You can withdraw again in ${hours}h ${minutes}m ${seconds}s`,
        timeRemaining: timeRemaining,
        nextWithdrawalTime: nextWithdrawalTime.toISOString()
      });
    }
  }

  const minWithdrawalAmount = botConfig.minWithdrawal[currency];
  
  if (user.balance < minWithdrawalAmount) {
    return res.json({ success: false, message: 'Insufficient balance' });
  }

  // For Flexy, require phone number instead of binanceId
  let paymentDetails = {};
  if (currency === 'FLEXY') {
    if (!phoneNumber) {
      return res.json({ success: false, message: 'Phone number is required for Flexy withdrawal' });
    }
    paymentDetails = { phoneNumber: phoneNumber };
  } else {
    if (!binanceId) {
      return res.json({ success: false, message: 'Binance ID is required for this withdrawal method' });
    }
    paymentDetails = { binanceId: binanceId };
  }

  // Create withdrawal record
  const withdrawal = {
    id: Date.now().toString(),
    userId: userId,
    username: user.username,
    currency: currency,
    ...paymentDetails,
    amount: minWithdrawalAmount,
    date: new Date().toISOString(),
    status: 'pending'
  };

  // Add to user's withdrawal history
  user.withdrawalHistory.push({
    id: withdrawal.id,
    currency: currency,
    amount: minWithdrawalAmount,
    ...paymentDetails,
    date: new Date().toISOString(),
    status: 'pending'
  });

  // Add to pending withdrawals
  pendingWithdrawals.push(withdrawal);
  
  // Deduct only the minimum withdrawal amount
  user.balance = Math.max(0, user.balance - minWithdrawalAmount);
  
  // Update coins to reflect the new balance
  user.coins = Math.floor(user.balance / botConfig.coinToUsdRate);
  
  const paymentInfo = currency === 'FLEXY' ? `phone ${phoneNumber}` : `Binance ID ${binanceId}`;
  console.log(`Withdrawal request submitted: ${currency} ${minWithdrawalAmount.toFixed(6)} to ${paymentInfo} for user ${userId} (${user.username}). Only minimum amount deducted.`);

  // Add current config to user data for consistent display
  const userWithConfig = {
    ...user,
    dailyAdLimit: botConfig.dailyAdLimit,
    adReward: botConfig.adReward,
    referralBonus: botConfig.referralBonus,
    minWithdrawal: botConfig.minWithdrawal,
    coinToUsdRate: botConfig.coinToUsdRate
  };

  res.json({ success: true, user: userWithConfig, message: 'Withdrawal request submitted for admin approval. Only minimum amount deducted.' });
});

// Admin API Routes
app.get('/api/admin/data', (req, res) => {
  const users = Array.from(usersData.values());
  const totalEarnings = users.reduce((sum, user) => sum + user.totalEarnings, 0);

  res.json({
    success: true,
    totalUsers: users.length,
    totalEarnings: totalEarnings,
    pendingWithdrawals: pendingWithdrawals.length,
    users: users,
    withdrawals: pendingWithdrawals,
    config: botConfig
  });
});

app.post('/api/admin/edit-user', (req, res) => {
  const { userId, balance, coins } = req.body;
  const user = usersData.get(userId);

  if (!user) {
    return res.json({ success: false, message: 'User not found' });
  }

  user.balance = balance;
  user.coins = coins;

  console.log(`Admin edited user ${user.username} (${userId}): balance=${balance}, coins=${coins}`);
  res.json({ success: true, user: user });
});

app.post('/api/admin/delete-user', (req, res) => {
  const { userId } = req.body;
  const user = usersData.get(userId);

  if (!user) {
    return res.json({ success: false, message: 'User not found' });
  }

  usersData.delete(userId);
  console.log(`Admin deleted user ${user.username} (${userId})`);
  res.json({ success: true });
});

// Get user withdrawal history
app.post('/api/withdrawal-history', (req, res) => {
  const { userId } = req.body;
  const user = usersData.get(userId);

  if (!user) {
    return res.json({ success: false, message: 'User not found' });
  }

  const withdrawalHistory = user.withdrawalHistory || [];
  
  // Sort by date (newest first)
  const sortedHistory = withdrawalHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  res.json({ success: true, withdrawals: sortedHistory });
});

app.post('/api/admin/approve-withdrawal', (req, res) => {
  const { withdrawalIndex } = req.body;
  const withdrawal = pendingWithdrawals[withdrawalIndex];

  if (!withdrawal) {
    return res.json({ success: false, message: 'Withdrawal not found' });
  }

  // Update user's withdrawal history status
  const user = usersData.get(withdrawal.userId);
  if (user && user.withdrawalHistory) {
    const userWithdrawal = user.withdrawalHistory.find(w => w.id === withdrawal.id);
    if (userWithdrawal) {
      userWithdrawal.status = 'approved';
      userWithdrawal.approvedDate = new Date().toISOString();
    }
  }

  // Balance is already deducted when withdrawal was requested, so just approve
  console.log(`Admin approved withdrawal: ${withdrawal.currency} ${withdrawal.amount} to Binance ID ${withdrawal.binanceId} for ${withdrawal.username}`);
  pendingWithdrawals.splice(withdrawalIndex, 1);
  res.json({ success: true });
});

app.post('/api/admin/reject-withdrawal', (req, res) => {
  const { withdrawalIndex } = req.body;
  const withdrawal = pendingWithdrawals[withdrawalIndex];

  if (!withdrawal) {
    return res.json({ success: false, message: 'Withdrawal not found' });
  }

  // Update user's withdrawal history status
  const user = usersData.get(withdrawal.userId);
  if (user) {
    // Refund the amount since withdrawal was rejected
    user.balance += withdrawal.amount;
    user.coins = Math.floor(user.balance / botConfig.coinToUsdRate);
    
    // Update withdrawal history
    if (user.withdrawalHistory) {
      const userWithdrawal = user.withdrawalHistory.find(w => w.id === withdrawal.id);
      if (userWithdrawal) {
        userWithdrawal.status = 'rejected';
        userWithdrawal.rejectedDate = new Date().toISOString();
      }
    }
  }

  console.log(`Admin rejected withdrawal: ${withdrawal.currency} ${withdrawal.amount} for ${withdrawal.username}. Amount refunded.`);
  pendingWithdrawals.splice(withdrawalIndex, 1);
  res.json({ success: true });
});

app.post('/api/admin/update-settings', (req, res) => {
  try {
    const newConfig = req.body;
    console.log('Received config update:', newConfig);

    // Validate the config
    if (typeof newConfig.adReward !== 'number' || newConfig.adReward < 1) {
      return res.json({ success: false, message: 'Invalid ad reward value' });
    }

    if (typeof newConfig.dailyAdLimit !== 'number' || newConfig.dailyAdLimit < 1) {
      return res.json({ success: false, message: 'Invalid daily ad limit value' });
    }

    if (typeof newConfig.referralBonus !== 'number' || newConfig.referralBonus < 0) {
      return res.json({ success: false, message: 'Invalid referral bonus value' });
    }

    // Update the config
    botConfig = {
      ...botConfig,
      adReward: newConfig.adReward,
      dailyAdLimit: newConfig.dailyAdLimit,
      referralBonus: newConfig.referralBonus,
      minWithdrawal: {
        TON: newConfig.minWithdrawal.TON,
        TRX: newConfig.minWithdrawal.TRX,
        USDT: newConfig.minWithdrawal.USDT,
        FLEXY: newConfig.minWithdrawal.FLEXY || 0.400000
      }
    };

    console.log('Admin updated bot configuration:', botConfig);
    
    // Sync config with bot
    syncConfigWithBot();
    
    res.json({ success: true, config: botConfig, message: 'Settings updated and synced with bot' });
  } catch (error) {
    console.error('Error updating config:', error);
    res.json({ success: false, message: 'Server error' });
  }
});

app.post('/api/admin/broadcast-message', (req, res) => {
  try {
    const { message, sendToAll } = req.body;

    if (!message || typeof message !== 'string') {
      return res.json({ success: false, message: 'Invalid message content' });
    }

    if (!sendToAll) {
      return res.json({ success: false, message: 'Send to all users option must be enabled' });
    }

    // Get all users
    const users = Array.from(usersData.values());
    let sentCount = 0;

    // Try to send message via bot
    try {
      const botModule = require('./index');
      if (botModule && botModule.sendBroadcastMessage) {
        sentCount = botModule.sendBroadcastMessage(message, users);
      } else {
        // Fallback method - get bot instance directly
        const TelegramBot = require('node-telegram-bot-api');
        const BOT_TOKEN = '8007258891:AAFVZLpTUc8HfXqaBCHDh92RY_D91SG_5bY';
        const bot = new TelegramBot(BOT_TOKEN);

        // Send to all users
        users.forEach(user => {
          try {
            bot.sendMessage(user.userId, message, { parse_mode: 'Markdown' });
            sentCount++;
          } catch (error) {
            console.log(`Failed to send message to user ${user.userId}:`, error.message);
          }
        });
      }
    } catch (error) {
      console.log('Error accessing bot for broadcast:', error.message);
      return res.json({ success: false, message: 'Bot not available for broadcasting' });
    }

    console.log(`Admin sent broadcast message to ${sentCount} users: "${message}"`);
    res.json({ success: true, sentCount: sentCount, message: 'Broadcast message sent successfully' });

  } catch (error) {
    console.error('Error sending broadcast message:', error);
    res.json({ success: false, message: 'Server error' });
  }
});

// Admin panel route
app.get('/hkm', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🌐 Web App is running on port ${port}`);
  console.log(`🔗 Access the app at: http://localhost:${port}`);
});

function getBotConfig() {
  return botConfig;
}

module.exports = { setUsersData, getBotConfig };