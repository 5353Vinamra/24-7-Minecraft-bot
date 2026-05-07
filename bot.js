require('dotenv').config();
const express = require('express');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const Groq = require("groq-sdk");

// --- Web Server ---
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send("Bot is Active."));
app.listen(port, () => console.log("<------------------------------------->"));

const config = require('./settings.json');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- IDENTITY SWAP LOGIC ---
const accountsData = JSON.parse(fs.readFileSync('./launcher-accounts.json', 'utf8'));
const accounts = accountsData.accounts;
const randomAccount = accounts[Math.floor(Math.random() * accounts.length)];
const randomMinutes = Math.floor(Math.random() * (270 - 30 + 1) + 30);

console.log(`\x1b[33m[Identity Swap]\x1b[0m Selected: ${randomAccount.username}`);

// --- MEMORY SYSTEM ---
const badWords = [];
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

    bot.on('spawn', () => {
        console.log(`\x1b[32m[BotLog]\x1b[0m ${bot.username} joined.`);
        if (config.utils['auto-auth'].enabled) {
            const pass = randomAccount.auth_password || process.env.AUTO_AUTH_PASSWORD || config.utils['auto-auth'].password;
            setTimeout(() => {
                bot.chat(`/register ${pass} ${pass}`);
                setTimeout(() => bot.chat(`/login ${pass}`), 500);
            }, 1000); 
        }
    });

    // --- ENHANCED MESSAGE SCANNER ---
    bot.on('message', async (jsonMsg) => {
        const rawText = jsonMsg.toString();
        if (!rawText || rawText.trim().length < 2) return;

        // SKIP IF BOT IS THE ONE TALKING
        if (rawText.includes(bot.username)) return;

        // 1. EXTRACT USERNAME (Support for Vanilla, Essentials, and LuckPerms formats)
        let sender = "Player";
        const parts = rawText.split(/\s+/);
        
        // Matches <Name>, [Prefix] Name, or Name: formats
        const match = rawText.match(/<([^>]+)>/) || rawText.match(/([a-zA-Z0-9_]{3,16})(?=\s*[:»>])/) || rawText.match(/\]\s*([a-zA-Z0-9_]{3,16})/);
        
        if (match) {
            sender = match[1].replace(/[<>\[\]]/g, '').trim();
        }

        const lowerMessage = rawText.toLowerCase();

        // 2. PROFANITY FILTER
        if (badWords.some(word => lowerMessage.includes(word))) {
            bot.chat(`${sender}, I will not give you any answer and will request for your ban from Vartiax. Please do not abuse!`);
            return;
        }

        // 3. AI BRAIN TRIGGER
        if (lowerMessage.includes('!ask') || lowerMessage.includes(bot.username.toLowerCase())) {
            
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

                // Remember the bot's own reply
                conversationHistory.push({ role: "assistant", content: finalReply });
                if (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();

            } catch (error) {
                console.error("AI Error:", error.message);
            }
        }
    });

    bot.on('end', () => { if (config.utils['auto-reconnect']) process.exit(0); });
}

createBot();

setTimeout(() => { process.exit(0); }, randomMinutes * 60 * 1000);
