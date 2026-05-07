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
const badWords = ['fuck', 'shit', 'bitch', 'asshole', 'dumbass', 'crap']; // Add or remove words here

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

        // --- Auto Auth ---
        if (config.utils['auto-auth'].enabled) {
            const pass = randomAccount.auth_password || process.env.AUTO_AUTH_PASSWORD || config.utils['auto-auth'].password;
            setTimeout(() => {
                bot.chat(`/register ${pass} ${pass}`);
                setTimeout(() => bot.chat(`/login ${pass}`), 500);
            }, 1000); 
        }

        // --- Anti-AFK ---
        if (config.utils['anti-afk'].enabled) {
            bot.setControlState('jump', true);
        }
    });

    // --- AI CHAT LISTENER & PROFANITY FILTER ---
    bot.on('chat', async (username, message) => {
        if (username === bot.username) return;

        const lowerMessage = message.toLowerCase();

        // 1. Check for abusive language FIRST
        const containsBadWord = badWords.some(word => lowerMessage.includes(word));

        if (containsBadWord) {
            userWarnings[username] = (userWarnings[username] || 0) + 1;
            const offenses = userWarnings[username];

            if (offenses === 1) {
                bot.chat(`${username}, please do not use abusive language! This is your first warning.`);
            } else if (offenses === 2) {
                bot.chat(`${username}, STOP using abusive language! This is your final warning.`);
            } else if (offenses >= 3) {
                // Warning message and stop replying
                bot.chat(`${username}, I will not give you any answer and will request for your ban from Vinamra. Please do not abuse!`);
            }
            return; // This line ensures the AI will completely ignore their question if they swore
        }

        // 2. AI Brain (If message is clean)
        if (lowerMessage.includes(bot.username.toLowerCase()) || message.startsWith('!ask ')) {
            const userPrompt = message.replace('!ask ', '').trim();

            try {
                const chatCompletion = await groq.chat.completions.create({
                    messages: [
                        { 
                          role: "system", 
                          content: `You are a knowledgeable Minecraft assistant named ${bot.username}. Your owner and administrator is Vinamra.
                          - Knowledge: You are an expert in Minecraft recipes, Redstone logic, and survival mechanics.
                          - Style: Be mature, professional, and directly helpful. Provide accurate information without roleplay, jokes, or slang.
                          - Rule: Keep all answers concise and strictly under 180 characters.` 
                        },
                        { role: "user", content: userPrompt }
                    ],
                    model: "llama-3.1-70b-versatile",
                });

                const responseText = chatCompletion.choices[0].message.content;
                bot.chat(responseText.replace(/\n/g, ' ').substring(0, 255));

            } catch (error) {
                console.error("AI Error:", error);
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
