require('dotenv').config();
const express = require('express');
const fs = require('fs');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalBlock } } = require('mineflayer-pathfinder');

// --- Web Server (Keeps port open for hosting environments) ---
const app = express();
const port = 3000;
app.get('/', (req, res) => res.send("Visit discord.gg/yhcodes"));
app.listen(port, () => console.log("<------------------------------------->"));

const config = require('./settings.json');

// --- IDENTITY SWAP LOGIC ---
const accountsData = JSON.parse(fs.readFileSync('./launcher-accounts.json', 'utf8'));
const accounts = accountsData.accounts;

if (accounts.length === 0) {
    console.error("\x1b[31m[ERROR] No accounts found in launcher-accounts.json!\x1b[0m");
    process.exit(1);
}

// 1. Pick a random account from the array
const randomAccount = accounts[Math.floor(Math.random() * accounts.length)];

// 2. Set random stay duration (e.g., between 30 mins and 4.5 hours)
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
            // Uses GitHub Secret if available, otherwise falls back to settings.json
            const pass = process.env.AUTO_AUTH_PASSWORD || config.utils['auto-auth'].password;
            setTimeout(() => {
                bot.chat(`/register ${pass} ${pass}`);
                bot.chat(`/login ${pass}`);
            }, 500);
            console.log("[Auth] Authentication commands executed.");
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

    bot.on('goal_reached', () => {
        console.log(`\x1b[32m[BotLog] Bot arrived to target location.\x1b[0m`);
    });

    bot.on('death', () => {
        console.log(`\x1b[33m[BotLog] Bot has died and was respawned\x1b[0m`);
    });

    bot.on('kicked', (reason) => {
        console.log(`\x1b[33m[BotLog] Bot was kicked from the server. Reason: \n${reason}\x1b[0m`);
    });

    bot.on('error', (err) => {
        console.log(`\x1b[31m[ERROR]\x1b[0m ${err.message}`);
    });

    bot.on('end', () => {
        console.log(`\x1b[31m[BotLog] Bot disconnected.\x1b[0m`);
        if (config.utils['auto-reconnect']) {
            console.log(`\x1b[33m[BotLog] Reconnecting via GitHub Actions loop...\x1b[0m`);
            process.exit(0); // Exit so the bot.yml loop handles the clean restart
        }
    });
}

createBot();

// --- Random Identity Swap Timer ---
setTimeout(() => {
    console.log(`\x1b[33m[Identity Swap]\x1b[0m Time is up! Shutting down to trigger a bot swap...`);
    process.exit(0); 
}, randomMinutes * 60 * 1000);
