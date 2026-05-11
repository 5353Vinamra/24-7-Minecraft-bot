require('dotenv').config();
const express = require('express');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const Groq = require("groq-sdk");

// --- Web Server ---
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send("Bot System Active."));
app.listen(port, () => console.log("<------------------------------------->"));

const config = require('./settings.json');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- IDENTITY SWAP LOGIC ---
const accountsData = JSON.parse(fs.readFileSync('./launcher-accounts.json', 'utf8'));
const accounts = accountsData.accounts;
const randomAccount = accounts[Math.floor(Math.random() * accounts.length)];

// Updated Duration: 30 minutes to 4 hours (240 minutes)
const minMinutes = 30;
const maxMinutes = 240; 
const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1) + minMinutes);

// FIX: Calculate IST Time accurately for GitHub Actions (UTC +5.5 hours)
const now = new Date();
const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
const endTime = new Date(now.getTime() + (randomMinutes * 60 * 1000));
const istTimeDisplay = new Date(endTime.getTime() + istOffset).toLocaleTimeString('en-IN', { timeZone: 'UTC' });

console.log(`\x1b[35m[SYSTEM] New Identity Selected: ${randomAccount.username}\x1b[0m`);
console.log(`\x1b[35m[SYSTEM] Scheduled Swap: In ${randomMinutes} minutes (at ${istTimeDisplay} IST)\x1b[0m`);

// --- MEMORY SYSTEM ---
const badWords = ['fuck', 'shit', 'bitch', 'asshole', 'dumbass', 'crap'];
let conversationHistory = []; 
const MAX_HISTORY = 50; 

function createBot() {
    const bot = mineflayer.createBot({
        host: process.env.SERVER_IP || config.server.ip,
        port: process.env.SERVER_PORT || config.server.port,
        username: randomAccount.username,
        password: randomAccount.password || "",
        // CRITICAL: Ensure server is cracked (online-mode=false) for offline auth to work
        auth: randomAccount.type || config['bot-account'].type || "offline",
        version: config.server.version
    });

    bot.loadPlugin(pathfinder);

    let isConnected = false;

    // --- LOGGING EVENTS ---
    bot.on('login', () => {
        isConnected = true; // Bot has successfully bypassed the server authentication checks
    });

    bot.on('spawn', () => {
        if (isConnected) {
            console.log(`\x1b[32m[SUCCESS] ${bot.username} is now online and actually spawned in the world.\x1b[0m`);
            if (config.utils['auto-auth'].enabled) {
                const pass = randomAccount.auth_password || process.env.AUTO_AUTH_PASSWORD || config.utils['auto-auth'].password;
                setTimeout(() => {
                    bot.chat(`/register ${pass} ${pass}`);
                    setTimeout(() => {
                        bot.chat(`/login ${pass}`);
                        console.log(`\x1b[32m[SUCCESS] ${bot.username} auto-authenticated with login plugin.\x1b[0m`);
                    }, 500);
                }, 1000); 
            }
        }
    });

    // 1. Kick/Ban Detector (Fixed fake logs)
    bot.on('kicked', (reason) => {
        isConnected = false; // Reset connection state
        let cleanReason = "";
        try { 
            const parsed = JSON.parse(reason);
            cleanReason = parsed.text || reason; 
        } catch(e) { cleanReason = reason; }
        
        console.log(`\x1b[31m[ALERT] ${bot.username} WAS KICKED/REJECTED!\x1b[0m`);
        console.log(`\x1b[31m[REASON] ${cleanReason}\x1b[0m`);

        // Check if the server is rejecting offline accounts
        if (cleanReason.toLowerCase().includes("online")) {
            console.log(`\x1b[33m[TIP] The server is rejecting the bot because the server is in Premium Mode. Set 'online-mode=false' in your server.properties.\x1b[0m`);
        }
    });

    // 2. Error Detector
    bot.on('error', (err) => {
        console.log(`\x1b[31m[ERROR] Connection Error: ${err.message}\x1b[0m`);
    });

    // --- ENHANCED MESSAGE SCANNER (FIXED FOR IN-GAME REPLIES) ---
    bot.on('messagestr', async (message) => {
        const rawText = message.trim();
        if (!rawText || rawText.length < 2) return;

        // SKIP IF BOT IS THE ONE TALKING
        if (rawText.includes(bot.username)) return;

        const lowerMessage = rawText.toLowerCase();

        // 1. SENDER DETECTION (Handles prefixes like [Owner] Vartiax:)
        const nameMatch = rawText.match(/([a-zA-Z0-9_]{3,16})(?=\s*[:»>])/);
        const sender = nameMatch ? nameMatch[1] : "Player";

        // 2. PROFANITY FILTER
        if (badWords.some(word => lowerMessage.includes(word))) {
            console.log(`\x1b[33m[CHAT] Abusive behavior blocked from: ${sender}\x1b[0m`);
            bot.chat(`${sender}, I will not give you any answer and will request your ban from Vartiax. Please do not abuse!`);
            return;
        }

        // 3. AI BRAIN TRIGGER
        if (lowerMessage.includes('!ask') || lowerMessage.includes(bot.username.toLowerCase())) {
            
            console.log(`\x1b[36m[AI] Request received from ${sender}: "${rawText}"\x1b[0m`);

            // Clean the prompt
            const cleanPrompt = rawText.replace(new RegExp(`!ask|${bot.username}`, 'gi'), '').trim();
            
            // Add to Memory
            conversationHistory.push({ role: "user", content: `Player ${sender} says: ${cleanPrompt}` });
            if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();

            try {
                const chatCompletion = await groq.chat.completions.create({
                    messages: [
                        { 
                          role: "system", 
                          content: `You are a professional Minecraft assistant named ${bot.username}. 
                          - Your administrator and creator is Vartiax. 
                          - Address the person talking to you by their name (${sender}). 
                          - You have full memory of the last 50 messages. Reference them to answer "follow-up" questions.
                          - You can answer ANY topic (science, math, coding, life).
                          - Style: Mature, professional. Max 180 chars. Do not use line breaks.` 
                        },
                        ...conversationHistory.slice(-15) // Limit history sent to Groq for speed/stability
                    ],
                    model: "llama-3.3-70b-versatile",
                });

                const responseText = chatCompletion.choices[0].message.content;
                // CLEANING: Strip newlines and extra quotes that break Minecraft chat packets
                const finalReply = responseText.replace(/[\n\r"]/g, ' ').substring(0, 255);
                
                // DELAYED SEND: Prevents anti-spam plugins from shadow-banning the bot
                setTimeout(() => {
                    bot.chat(finalReply);
                    console.log(`\x1b[32m[SENT] Reply to ${sender}: ${finalReply}\x1b[0m`);
                }, 1500);

                // Remember the bot's own reply
                conversationHistory.push({ role: "assistant", content: finalReply });
                if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();

            } catch (error) {
                console.error(`\x1b[31m[AI ERROR] ${error.message}\x1b[0m`);
            }
        }
    });

    // 4. Disconnect Logging
    bot.on('end', () => { 
        console.log(`\x1b[31m[DISCONNECT] ${bot.username} connection ended.\x1b[0m`);
        if (config.utils['auto-reconnect']) {
            console.log(`\x1b[33m[SYSTEM] Auto-reconnect triggered. Restarting process in 5 seconds...\x1b[0m`);
            setTimeout(() => {
                 process.exit(0); 
            }, 5000); // Added a 5 second delay to prevent extreme spam if the server is completely down
        }
    });
}

createBot();

// Logging the countdown every 30 minutes in logs
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
