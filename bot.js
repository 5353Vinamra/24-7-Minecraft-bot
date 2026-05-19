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
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- IDENTITY SWAP & SUMMON LOGIC ---
const accountsData = JSON.parse(fs.readFileSync('./launcher-accounts.json', 'utf8'));
const accounts = accountsData.accounts;

let specificAccount = null;
if (fs.existsSync('./.next-bot.txt')) {
    const requestedName = fs.readFileSync('./.next-bot.txt', 'utf8').trim();
    specificAccount = accounts.find(acc => acc.username.toLowerCase() === requestedName.toLowerCase());
    fs.unlinkSync('./.next-bot.txt'); 
}

const randomAccount = specificAccount || accounts[Math.floor(Math.random() * accounts.length)];
const randomMinutes = Math.floor(Math.random() * (240 - 30 + 1) + 30); 

const now = new Date();
const istOffset = 5.5 * 60 * 60 * 1000; 
const endTime = new Date(now.getTime() + (randomMinutes * 60 * 1000));
const istTimeDisplay = new Date(endTime.getTime() + istOffset).toLocaleTimeString('en-IN', { timeZone: 'UTC' });

console.log(`\x1b[35m[SYSTEM] Active Identity: ${randomAccount.username} ${specificAccount ? '(SUMMONED)' : ''}\x1b[0m`);
console.log(`\x1b[35m[SYSTEM] Swap Scheduled: ${istTimeDisplay} IST\x1b[0m`);

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

        // 1. ADMIN COMMAND: !summon
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

        // --- LAYER 2: REAL AI RESPONDER ---
        if (lowerMessage.includes('!ask') || lowerMessage.includes(bot.username.toLowerCase())) {
            const cleanPrompt = rawText.replace(new RegExp(`!ask|${bot.username}`, 'gi'), '').trim();
            
            const userMessage = { role: "user", parts: [{ text: `Player ${sender} says: ${cleanPrompt}` }] };
            conversationHistory.push(userMessage);

            try {
                // CORRECT, ACTIVE MODERN MODEL WITH WEB SEARCH REMOVED TO PREVENT QUOTA CAPS
                const chatModel = genAI.getGenerativeModel({
                    model: "gemini-2",
                    systemInstruction: `You are a highly intelligent Minecraft assistant named ${bot.username}. Creator: Vartiax. 
                    You have expert knowledge of modern Minecraft versions, PvP mechanics, plugins, and redstone.
                    Address the user as ${sender}. Keep your response under 150 characters. No newlines or special formatting.`
                });

                console.log(`\x1b[34m[AI] Generating response for ${sender}...\x1b[0m`);
                
                const chatResult = await chatModel.generateContent({
                    contents: conversationHistory
                });

                // SAFETY FAILSAFE
                if (!chatResult.response || !chatResult.response.candidates || chatResult.response.candidates.length === 0) {
                    console.log(`\x1b[33m[AI] Request blocked by Google Safety Filters.\x1b[0m`);
                    bot.chat(`Sorry ${sender}, I cannot talk about that.`);
                    conversationHistory.pop();
                    return;
                }

                const finalReply = chatResult.response.text().replace(/[\n\r"]/g, ' ').substring(0, 255);
                setTimeout(() => { bot.chat(finalReply); }, 1500);
                
                conversationHistory.push({ role: "model", parts: [{ text: finalReply }] });
                
                if (conversationHistory.length > MAX_HISTORY * 2) {
                    conversationHistory.splice(0, 2);
                }

            } catch (e) { 
                console.error(`\x1b[31m[CHAT API ERROR] ${e.status || 'UNKNOWN'}: ${e.message}\x1b[0m`); 
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

const logInterval = setInterval(() => {
    const remaining = Math.round((endTime.getTime() - Date.now()) / 1000 / 60);
    if (remaining > 0) {
        console.log(`\x1b[34m[STATUS] ${randomAccount.username} active. ${remaining}m until swap.\x1b[0m`);
    }
}, 30 * 60 * 1000); 

setTimeout(() => { 
    process.exit(0); 
}, randomMinutes * 60 * 1000);
