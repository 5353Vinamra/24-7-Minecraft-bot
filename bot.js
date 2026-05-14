require('dotenv').config();
const express = require('express');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const Groq = require("groq-sdk");

// --- Web Server (Keeps the GitHub runner alive) ---
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send("Vartiax Bot System Active."));
app.listen(port, () => console.log("<------------------------------------->"));

const config = require('./settings.json');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- IDENTITY SWAP & SUMMON LOGIC ---
const accountsData = JSON.parse(fs.readFileSync('./launcher-accounts.json', 'utf8'));
const accounts = accountsData.accounts;

// Check if an admin used !summon to request a specific bot
let specificAccount = null;
if (fs.existsSync('./.next-bot.txt')) {
    const requestedName = fs.readFileSync('./.next-bot.txt', 'utf8').trim();
    specificAccount = accounts.find(acc => acc.username.toLowerCase() === requestedName.toLowerCase());
    fs.unlinkSync('./.next-bot.txt'); // Clear the file after reading
}

// Select the requested bot, or a random one
const randomAccount = specificAccount || accounts[Math.floor(Math.random() * accounts.length)];
const randomMinutes = Math.floor(Math.random() * (240 - 30 + 1) + 30); // 30m to 4h timer

// Accurate IST Calculation
const now = new Date();
const istOffset = 5.5 * 60 * 60 * 1000; 
const endTime = new Date(now.getTime() + (randomMinutes * 60 * 1000));
const istTimeDisplay = new Date(endTime.getTime() + istOffset).toLocaleTimeString('en-IN', { timeZone: 'UTC' });

console.log(`\x1b[35m[SYSTEM] Active Identity: ${randomAccount.username} ${specificAccount ? '(SUMMONED)' : ''}\x1b[0m`);
console.log(`\x1b[35m[SYSTEM] Swap Scheduled: ${istTimeDisplay} IST\x1b[0m`);

// --- THE IRON WALL PROFANITY SYSTEM ---
// Highly efficient O(1) regex matching system that survives symbol insertion and character spam
function checkProfanity(text) {
    let lower = text.toLowerCase();
    
    // 1. Decrypt Leetspeak
    let leetMap = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't' };
    let normalized = lower.replace(/[01!|34@5$7+]/g, m => leetMap[m] || m);
    
    // 2. Strip all non-alphabet characters (crushes spaces, periods, asterisks)
    let stripped = normalized.replace(/[^a-z]/g, '');

    // 3. Squeeze repeated characters (e.g., "ffuuuuuuuccckkk" -> "fuck")
    let squeezed = stripped.replace(/(.)\1+/g, '$1');

    // 4. Core Root Dictionary
    const badRoots = [
        // English
        /niga/, /nigr/, /nigga/, /negr/, 
        /fuck/, /fvck/, /phuck/, /bitch/, /shit/, /asshol/, /cunt/, /slut/, /whore/,
        /kys/, /suicid/, /seedcrack/, /s+e+e+d+c+r+a+c+k/, /seedcrack
        
        // Hindi
        /chutiya/, /choot/, /chuda/, 
        /bhencho/, /behencho/, /madarcho/, /makabho/, /bchod/, /mchod/,
        /gandu/, /gaand/, /randi/, /randwa/, 
        /bhosd/, /bosdi/, /bhoda/, 
        /lawda/, /loda/, /lauda/, /lund/, /tatti/, /jhaant/
    ];

    // If either the fully squeezed word or the stripped word matches a root, it flags it.
    return badRoots.some(r => r.test(squeezed) || r.test(stripped));
}

// --- MEMORY SYSTEM ---
let conversationHistory = []; 
const MAX_HISTORY = 50; 

function createBot() {
    const bot = mineflayer.createBot({
        host: process.env.SERVER_IP || config.server.ip,
        port: process.env.SERVER_PORT || config.server.port,
        username: randomAccount.username,
        auth: "offline",
        version: config.server.version
    });

    bot.loadPlugin(pathfinder);
    let isConnected = false;

    bot.on('login', () => { isConnected = true; });

    bot.on('spawn', () => {
        if (isConnected) {
            console.log(`\x1b[32m[SUCCESS] ${bot.username} deployed to server.\x1b[0m`);
            if (config.utils['auto-auth'].enabled) {
                const pass = process.env.AUTO_AUTH_PASSWORD || config.utils['auto-auth'].password;
                setTimeout(() => { 
                    bot.chat(`/register ${pass} ${pass}`); 
                    setTimeout(() => { bot.chat(`/login ${pass}`); }, 500); 
                }, 1000);
            }
        }
    });

    bot.on('kicked', (reason) => {
        let cleanReason = "";
        try { cleanReason = JSON.parse(reason).text || reason; } catch(e) { cleanReason = reason; }
        console.log(`\x1b[31m[KICKED/REJECTED] ${cleanReason}\x1b[0m`);
    });

    bot.on('error', (err) => {
        console.log(`\x1b[31m[ERROR] Connection Error: ${err.message}\x1b[0m`);
    });

    bot.on('messagestr', async (message) => {
        const rawText = message.trim();
        if (!rawText || rawText.includes(bot.username)) return;

        // 1. SENDER DETECTION (Handles plugin prefixes)
        const nameMatch = rawText.match(/([a-zA-Z0-9_]{3,16})(?=\s*[:»>])/);
        const sender = nameMatch ? nameMatch[1] : "Player";
        const lowerMessage = rawText.toLowerCase();

        // 2. THE IRON WALL FILTER (Executes before AI can process it)
        if (checkProfanity(rawText)) {
            // Absolute Immunity for Server Admin
            if (sender.toLowerCase() === "vartiax") {
                console.log(`\x1b[33m[SHIELD] Vartiax used flagged language. Bypass granted.\x1b[0m`);
                return;
            }
            
            console.log(`\x1b[31m[BAN] Filter bypassed by: ${sender}. Executing tempban.\x1b[0m`);
            bot.chat(`Filter bypass detected. ${sender} is banned for 1 hour.`);
            setTimeout(() => { bot.chat(`/tempban ${sender} 1h Automated Filter: Abusive Language`); }, 500);
            return;
        }

        // 3. ADMIN COMMAND: !summon <bot_name>
        if (lowerMessage.startsWith('!summon ') && sender.toLowerCase() === "vartiax") {
            const requestedBot = rawText.split(' ')[1].trim();
            if (accounts.find(a => a.username.toLowerCase() === requestedBot.toLowerCase())) {
                bot.chat(`Roger that, Vartiax. Summoning ${requestedBot}... Logging off.`);
                fs.writeFileSync('./.next-bot.txt', requestedBot);
                setTimeout(() => process.exit(0), 1000); // Forces GitHub Action to restart the bot
            } else {
                bot.chat(`I don't have ${requestedBot} in my databanks.`);
            }
            return;
        }

        // 4. GROQ AI RESPONDER
        if (lowerMessage.includes('!ask') || lowerMessage.includes(bot.username.toLowerCase())) {
            const cleanPrompt = rawText.replace(new RegExp(`!ask|${bot.username}`, 'gi'), '').trim();
            conversationHistory.push({ role: "user", content: `Player ${sender} says: ${cleanPrompt}` });

            try {
                const chatCompletion = await groq.chat.completions.create({
                    messages: [
                        { 
                          role: "system", 
                          content: `You are a Minecraft assistant named ${bot.username}. Creator: Vartiax. Address the user by their name (${sender}). Max 150 chars. No newlines.` 
                        },
                        ...conversationHistory.slice(-10) // Limit to last 10 for API speed
                    ],
                    model: "llama-3.3-70b-versatile",
                });

                // Clean the output so it doesn't break Minecraft chat formatting
                const finalReply = chatCompletion.choices[0].message.content.replace(/[\n\r"]/g, ' ').substring(0, 255);
                
                // Delay stops the server from shadow-banning the bot for "spamming"
                setTimeout(() => { 
                    bot.chat(finalReply); 
                    console.log(`\x1b[32m[SENT] Reply to ${sender}: ${finalReply}\x1b[0m`);
                }, 1500);
                
                conversationHistory.push({ role: "assistant", content: finalReply });
                if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();

            } catch (e) { 
                console.error(`\x1b[31m[AI ERROR] ${e.message}\x1b[0m`); 
            }
        }
    });

    // Auto-Restart logic if connection drops
    bot.on('end', () => { 
        console.log(`\x1b[31m[DISCONNECT] ${bot.username} connection ended.\x1b[0m`);
        if (config.utils['auto-reconnect']) {
            console.log(`\x1b[33m[SYSTEM] Auto-reconnect triggered. Restarting process in 5 seconds...\x1b[0m`);
            setTimeout(() => process.exit(0), 5000); 
        }
    });
}

createBot();

// Logging countdown timer
const logInterval = setInterval(() => {
    const remaining = Math.round((endTime.getTime() - Date.now()) / 1000 / 60);
    if (remaining > 0) {
        console.log(`\x1b[34m[STATUS] ${randomAccount.username} is active. ${remaining} minutes until next identity swap.\x1b[0m`);
    }
}, 30 * 60 * 1000); 

// The actual identity swap trigger
setTimeout(() => { 
    console.log(`\x1b[35m[SYSTEM] Time expired. Forcing identity swap now...\x1b[0m`);
    clearInterval(logInterval);
    process.exit(0); 
}, randomMinutes * 60 * 1000);
