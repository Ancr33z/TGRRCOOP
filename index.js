const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) throw new Error("TELEGRAM_TOKEN env is required");

const TG = `https://api.telegram.org/bot${TOKEN}`;

async function sendMessage(chatId, text, replyMarkup) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  await axios.post(`${TG}/sendMessage`, payload);
}

function mainKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "🟢 Запросить кооп", callback_data: "REQ_COOP" },
        { text: "🔵 Ответить на кооп", callback_data: "RESP_COOP" }
      ],
      [
        { text: "📊 Моя статистика", callback_data: "MY_STATS" },
        { text: "🚪 Выйти из очереди", callback_data: "EXIT_QUEUE" }
      ],
      [{ text: "🎮 Указать игровой ник", callback_data: "SET_NICK" }]
    ]
  };
}

app.get("/", (req, res) => res.status(200).send("OK"));

app.post("/telegram", async (req, res) => {
  // важно: быстро отвечаем 200 Telegram
  res.status(200).send("OK");

  try {
    const update = req.body;

    if (update.message) {
      const chatId = update.message.chat.id;
      const text = (update.message.text || "").trim();

      if (/^\/start(\s|$|@)/i.test(text)) {
        await sendMessage(
          chatId,
          "Привет! Я кооп-бот 🤝\nНажми кнопки ниже 👇",
          mainKeyboard()
        );
        return;
      }

      await sendMessage(chatId, "Ок 🙂 Выбирай действие кнопками ниже 👇", mainKeyboard());
    }

    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      await axios.post(`${TG}/answerCallbackQuery`, {
        callback_query_id: update.callback_query.id
      });

      await sendMessage(chatId, "Пока что логика в разработке ✅", mainKeyboard());
    }
  } catch (e) {
    console.error("Webhook handler error:", e?.response?.data || e.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server listening on", port));
