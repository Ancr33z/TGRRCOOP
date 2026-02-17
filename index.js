const express = require("express");
const { buildBot } = require("./bot");

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID || "";
const BOT_PUBLIC_NAME = process.env.BOT_PUBLIC_NAME || "Кооп-бот";

if (!TOKEN) throw new Error("TELEGRAM_TOKEN env is required");
if (!SPREADSHEET_ID) throw new Error("SPREADSHEET_ID env is required");

const bot = buildBot({
  token: TOKEN,
  spreadsheetId: SPREADSHEET_ID,
  adminTgId: ADMIN_TG_ID,
  publicName: BOT_PUBLIC_NAME,
});

app.get("/", (req, res) => res.status(200).send("OK"));

app.post("/telegram", async (req, res) => {
  res.status(200).send("OK"); // отвечаем сразу

  try {
    const update = req.body;
    const msg = update.message || update.callback_query?.message;
    if (msg?.chat?.id) {
      console.log(
        "[TG_DEBUG]",
        JSON.stringify({
          updateType: update.message ? "message" : update.callback_query ? "callback_query" : "other",
          chatId: msg.chat.id,
          threadId: msg.message_thread_id || null,
        })
      );
    }

    if (update.message) await bot.handleMessage(update.message);
    else if (update.callback_query) await bot.handleCallback(update.callback_query);
  } catch (e) {
    console.error("Webhook error:", e?.response?.data || e?.message || e);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server listening on", port));
