require('dotenv').config();
const express = require('express');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- Web Server (Keeps the GitHub runner alive) ---
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send("Vartiax Gemini AI System Active."));
app.listen(port, () => console.log("<------------------------------------->"));

const config = require('./settings.json');

// --- INITIALIZE GOOGLE GEMINI AI ---
// This automatically pulls the 'GEMINI_API_KEY' from your GitHub Secrets
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- IDENTITY SWAP & SUMMON LOGIC ---
const accountsData = JSON.parse(fs.readFileSync('./launcher-accounts.json', 'utf8'));
const accounts = accountsData.accounts;

// Check if an admin used !summon to request a specific bot
let specificAccount = null;
if (fs.existsSync('./.next-bot.txt')) {
    const requestedName = fs.readFileSync('./.next-bot.txt', 'utf8').trim();
    specificAccount = accounts.find(acc => acc.username.toLowerCase() === requestedName.toLowerCase());
    fs.unlinkSync('./.next-bot.txt'); 
}

// Select the requested bot, or a random one (30m to 4h timer)
const randomAccount = specificAccount || accounts[Math.floor(Math.random() * accounts.length)];
const randomMinutes = Math.floor(Math.random() * (240 - 30 + 1) + 30); 

// Accurate IST Calculation (UTC +5.5 hours)
const now = new Date();
const istOffset = 5.5 * 60 * 60 * 1000; 
const endTime = new Date(now.getTime() + (randomMinutes * 60 * 1000));
const istTimeDisplay = new Date(endTime.getTime() + istOffset).toLocaleTimeString('en-IN', { timeZone: 'UTC' });

console.log(`\x1b[35m[SYSTEM] Active Identity: ${randomAccount.username} ${specificAccount ? '(SUMMONED)' : ''}\x1b[0m`);
console.log(`\x1b[35m[SYSTEM] Swap Scheduled: ${istTimeDisplay} IST\x1b[0m`);

// --- LAYER 1: THE IRON WALL (LOCAL FILTER + WHITELIST) ---
function checkProfanity(text) {
    let lower = text.toLowerCase();
    
    const whitelist = [
        /it'?s\s*hit/, /hit\s*n\s*try/, /glass/, /classic/, /grass/, /pass/
    ];
    if (whitelist.some(safe => safe.test(lower))) {
        return false; 
    }
    
    let leetMap = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't' };
    let normalized = lower.replace(/[01!|34@5$7+]/g, m => leetMap[m] || m);
    
    let stripped = normalized.replace(/[^a-z]/g, '');
    let squeezed = stripped.replace(/(.)\1+/g, '$1');

    const badRoots = [
        /niga/, /nigr/, /nigga/, /negr/, /fuck/, /fvck/, /phuck/, /bitch/, /shit/, /asshol/, /cunt/, /slut/, /whore/,
        /kys/, /suicid/, /seedcrack/, /s+e+e+d+c+r+a+c+k/,
        /chutiya/, /choot/, /chuda/, /bhencho/, /behencho/, /madarcho/, /makabho/, /bchod/, /mchod/,
        /gandu/, /gaand/, /randi/, /randwa/, /bhosd/, /bosdi/, /bhoda/, /lawda/, /loda/, /lauda/, /lund/, /tatti/, /jhaant/
    ];

    return badRoots.some(r => r.test(squeezed) || r.test(stripped));
}

// --- MEMORY SYSTEM ---
let conversationHistory = []; 
const MAX_HISTORY = 30; 

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

        const nameMatch = rawText.match(/([a-zA-Z0-9_]{3,16})(?=\s*[:»>])/);
        const sender = nameMatch ? nameMatch[1] : "Player";
        const lowerMessage = rawText.toLowerCase();

        // --- LAYER 2: AI-POWERED MODERATION (HIGH-CAPACITY LITE TIER) ---
        if (checkProfanity(rawText)) {
            if (sender.toLowerCase() === "vartiax") {
                console.log(`\x1b[33m[SHIELD] Vartiax used flagged language. Bypass granted.\x1b[0m`);
            } else {
                console.log(`\x1b[33m[MODERATION] Local filter flagged ${sender}. Asking AI for a second opinion...\x1b[0m`);
                
                let shouldBan = true; 

                try {
                    const modModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
                    const modPrompt = `You are a fair chat moderator. A local regex filter flagged the following message. Is it genuinely toxic, abusive, or a slur? Answer ONLY with the exact word 'BAN' if it is malicious, or 'CLEAR' if it is innocent, a false positive (like 'it's hit' triggering 'shit'), or mild. If unsure, answer 'CLEAR'.\n\nMessage: "${rawText}"`;
                    
                    const modResult = await modModel.generateContent(modPrompt);
                    const decision = modResult.response.text().trim().toUpperCase();

                    if (decision.includes("CLEAR")) {
                        shouldBan = false; 
                    }
                } catch (e) {
                    console.error(`\x1b[31m[AI ERROR] Moderation API unavailable. Falling back to Local Filter (BAN).\x1b[0m`);
                }

                if (shouldBan) {
                    console.log(`\x1b[31m[BAN] Toxicity confirmed by AI or Local Filter. Tempbanning 1h.\x1b[0m`);
                    bot.chat(`Filter bypass detected. ${sender} is banned for 1 hour.`);
                    setTimeout(() => { bot.chat(`/tempban ${sender} 1h Automated Filter: Abusive Language`); }, 500);
                    return; 
                } else {
                    console.log(`\x1b[32m[CLEAR] AI recognized a false positive. Message allowed.\x1b[0m`);
                }
            }
        }

        // 3. ADMIN COMMAND: !summon <bot_name> (Vartiax only)
        if (lowerMessage.startsWith('!summon ') && sender.toLowerCase() === "vartiax") {
            const requestedBot = rawText.split(' ')[1].trim();
            if (accounts.find(a => a.username.toLowerCase() === requestedBot.toLowerCase())) {
                bot.chat(`Roger that, Vartiax. Summoning ${requestedBot}... Logging off.`);
                fs.writeFileSync('./.next-bot.txt', requestedBot);
                setTimeout(() => process.exit(0), 1000); 
            } else {
                bot.chat(`I don't have ${requestedBot} in my launcher-accounts.json.`);
            }
            return;
        }

        // --- LAYER 4: REAL AI RESPONDER (HIGH-CAPACITY LITE TIER WITH WEB SEARCH) ---
        if (lowerMessage.includes('!ask') || lowerMessage.includes(bot.username.toLowerCase())) {
            const cleanPrompt = rawText.replace(new RegExp(`!ask|${bot.username}`, 'gi'), '').trim();
            
            const userMessage = { role: "user", parts: [{ text: `Player ${sender} says: ${cleanPrompt}` }] };
            conversationHistory.push(userMessage);

            try {
                const chatModel = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash-lite",
                    tools: [{ googleSearch: {} }], 
                    systemInstruction: `You are a highly intelligent Minecraft assistant named ${bot.username}. Creator: Vartiax. 
                    You have expert knowledge of modern Minecraft versions, PvP mechanics, plugins, and redstone.
                    If the user asks about something recent, real-world events, or facts you do not know, use your Google Search tool to look up the correct information. Do not guess or hallucinate features.
                    Address the user as ${sender}. Keep your response under 150 characters. No newlines or special formatting.`
                });

                console.log(`\x1b[34m[AI] Processing request with live Google Search...\x1b[0m`);
                
                const chatResult = await chatModel.generateContent({
                    contents: conversationHistory
                });

                const finalReply = chatResult.response.text().replace(/[\n\r"]/g, ' ').substring(0, 255);
                setTimeout(() => { bot.chat(finalReply); }, 1500);
                
                conversationHistory.push({ role: "model", parts: [{ text: finalReply }] });
                
                if (conversationHistory.length > MAX_HISTORY * 2) {
                    conversationHistory.splice(0, 2);
                }

            } catch (e) { 
                console.error(`\x1b[31m[AI ERROR] ${e.message}\x1b[0m`); 
                conversationHistory.pop();
            }
        }
    });

    bot.on('end', () => { 
        if (config.utils['auto-reconnect']) {
            setTimeout(() => process.exit(0), 5000); 
        }
    });
}

createBot();

// Countdown log
const logInterval = setInterval(() => {
    const remaining = Math.round((endTime.getTime() - Date.now()) / 1000 / 60);
    if (remaining > 0) {
        console.log(`\x1b[34m[STATUS] ${randomAccount.username} active. ${remaining}m until swap.\x1b[0m`);
    }
}, 30 * 60 * 1000); 

// Swap trigger
setTimeout(() => { 
    process.exit(0); 
}, randomMinutes * 60 * 1000);
