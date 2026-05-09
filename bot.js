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

// Shorter Duration Logic (15 to 60 minutes)
const minMinutes = 15;
const maxMinutes = 60; 
const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1) + minMinutes);
const endTime = Date.now() + (randomMinutes * 60 * 1000);

// Format time in IST
const istTime = new Date(endTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });

console.log(`\x1b[35m[SYSTEM] New Identity Selected: ${randomAccount.username}\x1b[0m`);
console.log(`\x1b[35m[SYSTEM] Scheduled Swap: In ${randomMinutes} minutes (at ${istTime} IST)\x1b[0m`);

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
        auth: randomAccount.type || config['bot-account'].type || "offline",
        version: config.server.version
    });

    bot.loadPlugin(pathfinder);

    // --- LOGGING EVENTS ---
    bot.on('spawn', () => {
        console.log(`\x1b[32m[SUCCESS] ${bot.username} is now online and spawned in the world.\x1b[0m`);
        if (config.utils['auto-auth'].enabled) {
            const pass = randomAccount.auth_password || process.env.AUTO_AUTH_PASSWORD || config.utils['auto-auth'].password;
            setTimeout(() => {
                bot.chat(`/register ${pass} ${pass}`);
                setTimeout(() => {
                    bot.chat(`/login ${pass}`);
                    console.log(`\x1b[32m[SUCCESS] ${bot.username} auto-authenticated.\x1b[0m`);
                }, 500);
            }, 1000); 
        }
    });

    // 1. Kick/Ban Detector
    bot.on('kicked', (reason) => {
        let cleanReason = reason;
        try { cleanReason = JSON.parse(reason).text || reason; } catch(e) {}
        console.log(`\x1b[31m[ALERT] ${bot.username} WAS KICKED/BANNED!\x1b[0m`);
        console.log(`\x1b[31m[REASON] ${cleanReason}\x1b[0m`);
    });

    // 2. Error Detector
    bot.on('error', (err) => {
        console.log(`\x1b[31m[ERROR] Connection Error: ${err.message}\x1b[0m`);
    });

    // --- ENHANCED MESSAGE SCANNER ---
    bot.on('message', async (jsonMsg) => {
        const rawText = jsonMsg.toString();
        if (!rawText || rawText.trim().length < 2) return;

        // SKIP IF BOT IS THE ONE TALKING
        if (rawText.includes(bot.username)) return;

        // 1. EXTRACT USERNAME
        let sender = "Player";
        const match = rawText.match(/<([^>]+)>/) || rawText.match(/([a-zA-Z0-9_]{3,16})(?=\s*[:»>])/) || rawText.match(/\]\s*([a-zA-Z0-9_]{3,16})/);
        
        if (match) {
            sender = match[1].replace(/[<>\[\]]/g, '').trim();
        }

        const lowerMessage = rawText.toLowerCase();

        // 2. PROFANITY FILTER
        if (badWords.some(word => lowerMessage.includes(word))) {
            console.log(`\x1b[33m[CHAT] Abusive behavior blocked from: ${sender}\x1b[0m`);
            bot.chat(`${sender}, I will not give you any answer and will request for your ban from Vartiax. Please do not abuse!`);
            return;
        }

        // 3. AI BRAIN TRIGGER
        if (lowerMessage.includes('!ask') || lowerMessage.includes(bot.username.toLowerCase())) {
            
            console.log(`\x1b[36m[AI] Request received from ${sender}: "${rawText.substring(0, 60)}..."\x1b[0m`);

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
                          - Address the person talking to you by their name (the one provided in the context). 
                          - You have full memory of the last 50 messages. Reference them to answer "follow-up" questions.
                          - You can answer ANY topic (science, math, coding, life).
                          - Style: Mature, professional. Max 180 chars.` 
                        },
                        ...conversationHistory
                    ],
                    model: "llama-3.3-70b-versatile",
                });

                const responseText = chatCompletion.choices[0].message.content;
                const finalReply = responseText.replace(/\n/g, ' ').substring(0, 255);
                
                bot.chat(finalReply);
                console.log(`\x1b[36m[AI] Sent reply to ${sender}\x1b[0m`);

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
        console.log(`\x1b[31m[DISCONNECT] ${bot.username} left the server.\x1b[0m`);
        if (config.utils['auto-reconnect']) {
            console.log(`\x1b[33m[SYSTEM] Auto-reconnect triggered. Restarting process...\x1b[0m`);
            process.exit(0); 
        }
    });
}

createBot();

// Logging the countdown every 15 minutes in logs
const logInterval = setInterval(() => {
    const remaining = Math.round((endTime - Date.now()) / 1000 / 60);
    if (remaining > 0) {
        console.log(`\x1b[34m[STATUS] ${bot.username} is active. ${remaining} minutes until next identity swap.\x1b[0m`);
    }
}, 15 * 60 * 1000); // 15 minutes

// The actual identity swap trigger
setTimeout(() => { 
    console.log(`\x1b[35m[SYSTEM] Time expired. Forcing identity swap now...\x1b[0m`);
    clearInterval(logInterval);
    process.exit(0); 
}, randomMinutes * 60 * 1000);
