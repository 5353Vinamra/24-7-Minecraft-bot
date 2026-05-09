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

// Duration Logic
const minMinutes = 30;
const maxMinutes = 270; 
const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1) + minMinutes);
const endTime = Date.now() + (randomMinutes * 60 * 1000);

console.log(`\x1b[35m[SYSTEM] New Identity: ${randomAccount.username}\x1b[0m`);
console.log(`\x1b[35m[SYSTEM] Scheduled Swap: In ${randomMinutes} minutes (at ${new Date(endTime).toLocaleTimeString()})\x1b[0m`);

// --- TRACKERS ---
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
        console.log(`\x1b[32m[SUCCESS] ${bot.username} is now online.\x1b[0m`);
        
        if (config.utils['auto-auth'].enabled) {
            const pass = randomAccount.auth_password || process.env.AUTO_AUTH_PASSWORD || config.utils['auto-auth'].password;
            setTimeout(() => {
                bot.chat(`/register ${pass} ${pass}`);
                setTimeout(() => bot.chat(`/login ${pass}`), 500);
            }, 1000); 
        }
    });

    // 1. Kick/Ban Detector
    bot.on('kicked', (reason) => {
        const cleanReason = JSON.parse(reason).text || reason;
        console.log(`\x1b[31m[ALERT] ${bot.username} WAS KICKED/BANNED!\x1b[0m`);
        console.log(`\x1b[31m[REASON] ${cleanReason}\x1b[0m`);
    });

    // 2. Error Detector
    bot.on('error', (err) => {
        console.log(`\x1b[31m[ERROR] Connection Error: ${err.message}\x1b[0m`);
    });

    // 3. AI Usage Monitor
    bot.on('message', async (jsonMsg) => {
        const rawText = jsonMsg.toString();
        if (!rawText || rawText.trim().length < 2) return;
        if (rawText.includes(bot.username)) return;

        let sender = "Player";
        const match = rawText.match(/<([^>]+)>/) || rawText.match(/([a-zA-Z0-9_]{3,16})(?=\s*[:»>])/) || rawText.match(/\]\s*([a-zA-Z0-9_]{3,16})/);
        if (match) sender = match[1].replace(/[<>\[\]]/g, '').trim();

        const lowerMessage = rawText.toLowerCase();

        if (badWords.some(word => lowerMessage.includes(word))) {
            console.log(`\x1b[33m[CHAT] Abusive behavior blocked from: ${sender}\x1b[0m`);
            bot.chat(`${sender}, I will not give you any answer and will request for your ban from Vartiax. Please do not abuse!`);
            return;
        }

        if (lowerMessage.includes('!ask') || lowerMessage.includes(bot.username.toLowerCase())) {
            console.log(`\x1b[36m[AI] Request from ${sender}: "${rawText.substring(0, 50)}..."\x1b[0m`);
            
            const cleanPrompt = rawText.replace(new RegExp(`!ask|${bot.username}`, 'gi'), '').trim();
            conversationHistory.push({ role: "user", content: `Player ${sender} says: ${cleanPrompt}` });
            if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();

            try {
                const chatCompletion = await groq.chat.completions.create({
                    messages: [
                        { 
                          role: "system", 
                          content: `You are a professional Minecraft assistant named ${bot.username}. Creator: Vartiax.
                          - Address the person by their name.
                          - You have full memory of the last 50 messages.
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

                conversationHistory.push({ role: "assistant", content: finalReply });
                if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();

            } catch (error) {
                console.log(`\x1b[31m[AI ERROR] ${error.message}\x1b[0m`);
            }
        }
    });

    bot.on('end', () => {
        console.log(`\x1b[31m[DISCONNECT] ${bot.username} left the server.\x1b[0m`);
        if (config.utils['auto-reconnect']) process.exit(0);
    });
}

createBot();

// Logging the countdown every 30 minutes in logs
const logInterval = setInterval(() => {
    const remaining = Math.round((endTime - Date.now()) / 1000 / 60);
    if (remaining > 0) {
        console.log(`\x1b[34m[STATUS] ${bot.username} still active. ${remaining} minutes until swap.\x1b[0m`);
    }
}, 30 * 60 * 1000);

setTimeout(() => {
    console.log(`\x1b[35m[SYSTEM] Time expired. Forcing identity swap...\x1b[0m`);
    clearInterval(logInterval);
    process.exit(0); 
}, randomMinutes * 60 * 1000);
