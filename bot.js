require('dotenv').config();
const express = require('express');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const Groq = require("groq-sdk");

// --- Web Server ---
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send("Visit discord.gg/yhcodes"));
app.listen(port, () => console.log("<------------------------------------->"));

const config = require('./settings.json');

// --- AI Setup ---
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// --- IDENTITY SWAP LOGIC ---
const accountsData = JSON.parse(fs.readFileSync('./launcher-accounts.json', 'utf8'));
const accounts = accountsData.accounts;

if (accounts.length === 0) {
    console.error("\x1b[31m[ERROR] No accounts found in launcher-accounts.json!\x1b[0m");
    process.exit(1);
}

const randomAccount = accounts[Math.floor(Math.random() * accounts.length)];
const minMinutes = 30;
const maxMinutes = 270; 
const randomMinutes = Math.floor(Math.random() * (maxMinutes - minMinutes + 1) + minMinutes);

console.log(`\x1b[33m[Identity Swap]\x1b[0m Selected Account: ${randomAccount.username}`);
console.log(`\x1b[33m[Identity Swap]\x1b[0m Staying online for ${randomMinutes} minutes.`);

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
        console.log(`\x1b[32m[BotLog]\x1b[0m ${bot.username} joined the server.`);

        // --- Auto Auth ---
        if (config.utils['auto-auth'].enabled) {
            console.log("[INFO] Started auto-auth module");
            const pass = randomAccount.auth_password || process.env.AUTO_AUTH_PASSWORD || config.utils['auto-auth'].password;
            
            setTimeout(() => {
                bot.chat(`/register ${pass} ${pass}`);
                setTimeout(() => {
                    bot.chat(`/login ${pass}`);
                    console.log("[Auth] Authentication commands executed.");
                }, 500);
            }, 1000); 
        }

        // --- Chat Messages ---
        if (config.utils['chat-messages'].enabled) {
            console.log("[INFO] Started chat-messages module");
            const messages = config.utils['chat-messages'].messages;
            if (config.utils['chat-messages'].repeat) {
                const delay = config.utils['chat-messages']['repeat-delay'];
                let i = 0;
                setInterval(() => {
                    bot.chat(messages[i]);
                    i = (i + 1) % messages.length;
                }, delay * 1000);
            }
        }

        // --- Position / Pathfinding ---
        if (config.position.enabled) {
            const pos = config.position;
            console.log(`\x1b[32m[BotLog] Starting moving to target location (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`);
            const mcData = require('minecraft-data')(bot.version);
            const defaultMove = new Movements(bot, mcData);
            bot.pathfinder.setMovements(defaultMove);
            bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
        }

        // --- Anti-AFK ---
        if (config.utils['anti-afk'].enabled) {
            bot.setControlState('jump', true);
            if (config.utils['anti-afk'].sneak) {
                bot.setControlState('sneak', true);
            }
        }
    });

    // --- AI Chat Listener ---
    bot.on('chat', async (username, message) => {
        if (username === bot.username) return; // Don't talk to yourself

        // The bot will reply if someone types "!ask <question>" OR if someone says the bot's current name
        if (message.toLowerCase().includes(bot.username.toLowerCase()) || message.startsWith('!ask ')) {
            const userPrompt = message.replace('!ask ', '').trim();

            try {
                const chatCompletion = await groq.chat.completions.create({
                    messages: [
                        { 
                          role: "system", 
                          content: `You are a helpful player named ${bot.username} on a private Minecraft server. Your owner and creator is Vinamra (also known as Vartiax). Answer questions playfully but accurately. Keep your answers under 200 characters so they fit perfectly in the in-game chat box.` 
                        },
                        { role: "user", content: userPrompt }
                    ],
                    model: "llama-3.1-8b-instant",
                });

                const responseText = chatCompletion.choices[0].message.content;
                // Minecraft chat breaks if there are new lines, so we replace them with spaces
                bot.chat(responseText.replace(/\n/g, ' ').substring(0, 255));
            } catch (error) {
                console.error("\x1b[31m[ERROR]\x1b[0m Groq AI failed:", error);
            }
        }
    });

    bot.on('goal_reached', () => console.log(`\x1b[32m[BotLog] Bot arrived to target location.\x1b[0m`));
    bot.on('death', () => console.log(`\x1b[33m[BotLog] Bot has died and was respawned\x1b[0m`));
    bot.on('kicked', (reason) => console.log(`\x1b[33m[BotLog] Bot was kicked from the server. Reason: \n${reason}\x1b[0m`));
    bot.on('error', (err) => console.log(`\x1b[31m[ERROR]\x1b[0m ${err.message}`));
    bot.on('end', () => {
        console.log(`\x1b[31m[BotLog] Bot disconnected.\x1b[0m`);
        if (config.utils['auto-reconnect']) {
            console.log(`\x1b[33m[BotLog] Reconnecting via GitHub Actions loop...\x1b[0m`);
            process.exit(0);
        }
    });
}

createBot();

setTimeout(() => {
    console.log(`\x1b[33m[Identity Swap]\x1b[0m Time is up! Shutting down to trigger a bot swap...`);
    process.exit(0); 
}, randomMinutes * 60 * 1000);
