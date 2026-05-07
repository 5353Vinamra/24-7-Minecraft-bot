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
const minMinutes = 30;
const maxMinutes = 270; 
const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1) + minMinutes);

console.log(`\x1b[33m[Identity Swap]\x1b[0m Selected: ${randomAccount.username}`);

// --- WARNING TRACKER ---
const userWarnings = {}; 
const badWords = ['fuck', 'shit', 'bitch', 'asshole', 'dumbass', 'crap'];

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

        if (config.utils['anti-afk'].enabled) {
            bot.setControlState('jump', true);
        }
    });

    // --- AI CHAT LISTENER & PROFANITY FILTER ---
    bot.on('message', async (jsonMsg) => {
        const rawText = jsonMsg.toString();
        if (!rawText || rawText.length < 2) return;

        // Skip if the message is from the bot itself
        if (rawText.includes(bot.username)) return;

        const lowerMessage = rawText.toLowerCase();

        // 1. Profanity Filter
        const containsBadWord = badWords.some(word => lowerMessage.includes(word));
        if (containsBadWord) {
            bot.chat(`I will not give you any answer and will request for your ban from Vinamra. Please do not abuse!`);
            return;
        }

        // 2. AI Brain Trigger (!ask or mentioning name)
        if (lowerMessage.includes('!ask') || lowerMessage.includes(bot.username.toLowerCase())) {
            
            // Clean the prompt: remove the trigger words
            const userPrompt = rawText.replace(new RegExp(`!ask|${bot.username}`, 'gi'), '').trim();

            try {
                const chatCompletion = await groq.chat.completions.create({
                    messages: [
                        { 
                          role: "system", 
                          content: `You are a professional Minecraft assistant named ${bot.username}. Your owner is Vinamra.
                          - Knowledge: Expert in recipes, Redstone, and survival mechanics.
                          - Style: Mature, professional, and helpful. No slang.
                          - Rule: Max 180 characters.` 
                        },
                        { role: "user", content: userPrompt }
                    ],
                    model: "llama-3.3-70b-versatile", // Updated to the non-decommissioned model
                });

                const responseText = chatCompletion.choices[0].message.content;
                bot.chat(responseText.replace(/\n/g, ' ').substring(0, 255));

            } catch (error) {
                console.error("\x1b[31m[ERROR]\x1b[0m AI Request Failed:", error.message);
            }
        }
    });

    bot.on('end', () => {
        if (config.utils['auto-reconnect']) process.exit(0);
    });
}

createBot();

setTimeout(() => {
    process.exit(0); 
}, randomMinutes * 60 * 1000);
