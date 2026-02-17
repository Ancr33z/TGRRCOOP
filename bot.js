const axios = require("axios");
const {
  nowIso_,
  appendRow_,
  updateCell_,
  findRowByValue_,
  findRowsByPredicate_,
  readTable_,
} = require("./sheets");

const SHEETS = {
  USERS: "Users",
  REQUESTS: "Requests",
  RESPONSES: "Responses",
  STATES: "States",
};

const REQUEST_STATUS = { OPEN: "OPEN", MATCHED: "MATCHED", CLOSED: "CLOSED" };
const RESPONSE_STATUS = { PENDING: "PENDING", ACCEPTED: "ACCEPTED", REJECTED: "REJECTED" };
const STATE = { NONE: "NONE" };

const CB = {
  REQUEST_COOP: "REQ_COOP",
  RESPOND_COOP: "RESP_COOP",
  EXIT_QUEUE: "EXIT_QUEUE",
  MY_STATS: "MY_STATS",
  PICK_REQUEST: "PICK_REQ",        // PICK_REQ|request_id
  PICK_RESPONDER: "PICK_RESP",     // PICK_RESP|request_id|responder_id
  SET_NICK: "SET_NICK",
  CHANGE_NICK: "CHANGE_NICK",
  CANCEL: "CANCEL",
};

function buildBot({ token, spreadsheetId, adminTgId, publicName }) {
  const TG = `https://api.telegram.org/bot${token}`;
  const SSID = spreadsheetId;

  async function tg(method, payload) {
    return axios.post(`${TG}/${method}`, payload);
  }

  async function sendMessage(chatId, text, replyMarkup) {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await tg("sendMessage", payload);
  }

  async function answerCallback(callbackQueryId) {
    await tg("answerCallbackQuery", { callback_query_id: callbackQueryId });
  }

  async function upsertUser(tgId, username, name) {
    const existing = await findRowByValue_(SSID, SHEETS.USERS, "tg_id", String(tgId));
    if (!existing) {
      await appendRow_(SSID, `${SHEETS.USERS}!A:A`, [
        String(tgId),
        username || "",
        name || "",
        "",
        0,
        nowIso_(),
        nowIso_(),
      ]);
      return;
    }
    // update username/name/last_active
    const { map, rowIndex1 } = existing;
    if (map.tg_username !== undefined) await updateCell_(SSID, `${SHEETS.USERS}!${col_(map.tg_username)}${rowIndex1}`, username || "");
    if (map.tg_name !== undefined) await updateCell_(SSID, `${SHEETS.USERS}!${col_(map.tg_name)}${rowIndex1}`, name || "");
    if (map.last_active !== undefined) await updateCell_(SSID, `${SHEETS.USERS}!${col_(map.last_active)}${rowIndex1}`, nowIso_());
  }

  async function getUserBrief(tgId) {
    const row = await findRowByValue_(SSID, SHEETS.USERS, "tg_id", String(tgId));
    if (!row) return null;
    const { map, row: r } = row;
    return {
      tg_id: String(r[map.tg_id] || ""),
      username: map.tg_username !== undefined ? String(r[map.tg_username] || "") : "",
      name: map.tg_name !== undefined ? String(r[map.tg_name] || "") : "",
      game_nick: map.game_nick !== undefined ? String(r[map.game_nick] || "") : "",
      score: map.score !== undefined ? Number(r[map.score] || 0) : 0,
    };
  }

  async function setGameNick(tgId, nick) {
    const row = await findRowByValue_(SSID, SHEETS.USERS, "tg_id", String(tgId));
    if (!row) {
      await appendRow_(SSID, `${SHEETS.USERS}!A:A`, [String(tgId), "", "", String(nick).trim(), 0, nowIso_(), nowIso_()]);
      return;
    }
    const { map, rowIndex1 } = row;
    if (map.game_nick === undefined) throw new Error("Users.game_nick column missing");
    await updateCell_(SSID, `${SHEETS.USERS}!${col_(map.game_nick)}${rowIndex1}`, String(nick).trim());
    if (map.last_active !== undefined) await updateCell_(SSID, `${SHEETS.USERS}!${col_(map.last_active)}${rowIndex1}`, nowIso_());
  }

  async function incrementScore(tgId, delta) {
    const row = await findRowByValue_(SSID, SHEETS.USERS, "tg_id", String(tgId));
    if (!row) return;
    const { map, rowIndex1, row: r } = row;
    if (map.score === undefined) throw new Error("Users.score column missing");
    const cur = Number(r[map.score] || 0);
    await updateCell_(SSID, `${SHEETS.USERS}!${col_(map.score)}${rowIndex1}`, cur + Number(delta || 0));
  }

  async function displayName(tgId) {
    const u = await getUserBrief(tgId);
    if (!u) return String(tgId);
    return String(u.game_nick || u.username || u.name || tgId).trim();
  }

  function mainKeyboard(uHasNick) {
    const nickBtn = uHasNick
      ? { text: "✏️ Изменить игровой ник", callback_data: CB.CHANGE_NICK }
      : { text: "🎮 Указать игровой ник", callback_data: CB.SET_NICK };

    return {
      inline_keyboard: [
        [
          { text: "🟢 Запросить кооп", callback_data: CB.REQUEST_COOP },
          { text: "🔵 Ответить на кооп", callback_data: CB.RESPOND_COOP },
        ],
        [
          { text: "📊 Моя статистика", callback_data: CB.MY_STATS },
          { text: "🚪 Выйти из очереди", callback_data: CB.EXIT_QUEUE },
        ],
        [nickBtn],
      ],
    };
  }

  async function findOpenRequestByRequester(requesterId) {
    const rows = await findRowsByPredicate_(SSID, SHEETS.REQUESTS, (r) =>
      String(r.requester_id) === String(requesterId) && String(r.status) === REQUEST_STATUS.OPEN
    );
    if (!rows.length) return null;
    // берём последний по строке (ближе к низу)
    const last = rows[rows.length - 1];
    return {
      rowIndex1: last.rowIndex1,
      request_id: String(last.obj.request_id),
      requester_id: String(last.obj.requester_id),
      status: String(last.obj.status),
    };
  }

  async function getRequestById(requestId) {
    const row = await findRowByValue_(SSID, SHEETS.REQUESTS, "request_id", String(requestId));
    if (!row) return null;
    const { map, rowIndex1, row: r } = row;
    return {
      rowIndex1,
      request_id: String(r[map.request_id] || ""),
      requester_id: String(r[map.requester_id] || ""),
      created_at: String(r[map.created_at] || ""),
      status: String(r[map.status] || ""),
      chosen_responder_id: map.chosen_responder_id !== undefined ? String(r[map.chosen_responder_id] || "") : "",
      closed_at: map.closed_at !== undefined ? String(r[map.closed_at] || "") : "",
    };
  }

  async function createRequest(requestId, requesterId) {
    await appendRow_(SSID, `${SHEETS.REQUESTS}!A:A`, [
      requestId,
      String(requesterId),
      nowIso_(),
      REQUEST_STATUS.OPEN,
      "",
      "",
    ]);
  }

  async function updateRequestMatched(requestId, chosenResponderId) {
    const row = await findRowByValue_(SSID, SHEETS.REQUESTS, "request_id", String(requestId));
    if (!row) return;
    const { map, rowIndex1 } = row;
    await updateCell_(SSID, `${SHEETS.REQUESTS}!${col_(map.status)}${rowIndex1}`, REQUEST_STATUS.MATCHED);
    if (map.chosen_responder_id !== undefined) {
      await updateCell_(SSID, `${SHEETS.REQUESTS}!${col_(map.chosen_responder_id)}${rowIndex1}`, String(chosenResponderId));
    }
  }

  async function updateRequestClosed(requestId) {
    const row = await findRowByValue_(SSID, SHEETS.REQUESTS, "request_id", String(requestId));
    if (!row) return;
    const { map, rowIndex1 } = row;
    await updateCell_(SSID, `${SHEETS.REQUESTS}!${col_(map.status)}${rowIndex1}`, REQUEST_STATUS.CLOSED);
    if (map.closed_at !== undefined) await updateCell_(SSID, `${SHEETS.REQUESTS}!${col_(map.closed_at)}${rowIndex1}`, nowIso_());
  }

  async function closeRequestWithoutMatch(requestId) {
    await updateRequestClosed(requestId);
  }

  async function listOpenRequestsExcluding(excludeRequesterId) {
    const rows = await findRowsByPredicate_(SSID, SHEETS.REQUESTS, (r) =>
      String(r.status) === REQUEST_STATUS.OPEN && String(r.requester_id) !== String(excludeRequesterId)
    );
    // берём последние сверху вниз — как в GAS
    return rows
      .map(x => ({
        request_id: String(x.obj.request_id),
        requester_id: String(x.obj.requester_id),
        created_at: String(x.obj.created_at || ""),
        status: String(x.obj.status),
      }))
      .reverse();
  }

  async function getResponse(requestId, responderId) {
    const rows = await findRowsByPredicate_(SSID, SHEETS.RESPONSES, (r) =>
      String(r.request_id) === String(requestId) && String(r.responder_id) === String(responderId)
    );
    if (!rows.length) return null;
    const one = rows[0];
    return {
      rowIndex1: one.rowIndex1,
      request_id: String(one.obj.request_id),
      responder_id: String(one.obj.responder_id),
      created_at: String(one.obj.created_at || ""),
      status: String(one.obj.status || ""),
      map: one.map,
    };
  }

  async function createOrUpdateResponse(requestId, responderId, status) {
    const existing = await getResponse(requestId, responderId);
    if (!existing) {
      await appendRow_(SSID, `${SHEETS.RESPONSES}!A:A`, [String(requestId), String(responderId), nowIso_(), status]);
      return;
    }
    const row = await findRowsByPredicate_(SSID, SHEETS.RESPONSES, (r) =>
      String(r.request_id) === String(requestId) && String(r.responder_id) === String(responderId)
    );
    if (!row.length) return;
    const { map, rowIndex1 } = row[0];
    await updateCell_(SSID, `${SHEETS.RESPONSES}!${col_(map.status)}${rowIndex1}`, status);
  }

  async function setResponseStatus(requestId, responderId, status) {
    await createOrUpdateResponse(requestId, responderId, status);
  }

  async function listPendingResponders(requestId) {
    const rows = await findRowsByPredicate_(SSID, SHEETS.RESPONSES, (r) =>
      String(r.request_id) === String(requestId) && String(r.status) === RESPONSE_STATUS.PENDING
    );
    return rows.map(x => String(x.obj.responder_id));
  }

  async function rejectOtherResponses(requestId, acceptedResponderId) {
    const rows = await findRowsByPredicate_(SSID, SHEETS.RESPONSES, (r) =>
      String(r.request_id) === String(requestId) &&
      String(r.status) === RESPONSE_STATUS.PENDING &&
      String(r.responder_id) !== String(acceptedResponderId)
    );

    for (const x of rows) {
      await updateCell_(SSID, `${SHEETS.RESPONSES}!${col_(x.map.status)}${x.rowIndex1}`, RESPONSE_STATUS.REJECTED);
    }
  }

  async function rejectAllPendingForRequest(requestId, reasonText) {
    const rows = await findRowsByPredicate_(SSID, SHEETS.RESPONSES, (r) =>
      String(r.request_id) === String(requestId) && String(r.status) === RESPONSE_STATUS.PENDING
    );

    for (const x of rows) {
      await updateCell_(SSID, `${SHEETS.RESPONSES}!${col_(x.map.status)}${x.rowIndex1}`, RESPONSE_STATUS.REJECTED);
      const responderId = String(x.obj.responder_id);
      await sendMessage(responderId, reasonText || "Не получилось законнектиться 😕", await kbFor(responderId));
    }
  }

  async function notifyRejectedResponders(requestId, acceptedResponderId) {
    const rows = await findRowsByPredicate_(SSID, SHEETS.RESPONSES, (r) =>
      String(r.request_id) === String(requestId)
    );

    for (const x of rows) {
      const rid = String(x.obj.responder_id);
      const st = String(x.obj.status);
      if (rid === String(acceptedResponderId)) continue;
      if (st === RESPONSE_STATUS.REJECTED) {
        await sendMessage(
          rid,
          "Не получилось законнектиться 😕\nПохоже, игрок выбрал другого. Попробуй ещё раз — сейчас точно найдёмся!",
          await kbFor(rid)
        );
      }
    }
  }

  async function notifyAdminMatch(requesterId, responderId) {
    if (!adminTgId) return;
    const l1 = await displayName(requesterId);
    const l2 = await displayName(responderId);

    await sendMessage(
      adminTgId,
      "🎯 Найден кооп-матч!\n" +
        "1) " + l1 + " (" + requesterId + ")\n" +
        "2) " + l2 + " (" + responderId + ")\n" +
        "Обоим начислено +1.",
      null
    );
  }

  async function kbFor(tgId) {
    const u = await getUserBrief(tgId);
    const hasNick = !!(u && String(u.game_nick || "").trim());
    return mainKeyboard(hasNick);
  }

  async function notifyRequesterWithPendingResponders(requesterId, requestId) {
    const req = await getRequestById(requestId);
    if (!req || req.status !== REQUEST_STATUS.OPEN) return;

    const pendings = await listPendingResponders(requestId);
    if (!pendings.length) return;

    const kb = { inline_keyboard: [] };
    for (const rid of pendings.slice(0, 10)) {
      const label = await displayName(rid);
      kb.inline_keyboard.push([
        { text: "✅ Выбрать " + label, callback_data: `${CB.PICK_RESPONDER}|${requestId}|${rid}` },
      ]);
    }
    kb.inline_keyboard.push([{ text: "✖️ Отмена", callback_data: CB.CANCEL }]);

    await sendMessage(requesterId, "На твой запрос есть отклики 🎯\nВыбери, с кем идёшь в кооп:", kb);
  }

  async function closeMatch(requestId, requesterId, chosenResponderId) {
    await updateRequestMatched(requestId, chosenResponderId);

    await setResponseStatus(requestId, chosenResponderId, RESPONSE_STATUS.ACCEPTED);
    await rejectOtherResponses(requestId, chosenResponderId);

    await incrementScore(requesterId, 1);
    await incrementScore(chosenResponderId, 1);

    await updateRequestClosed(requestId);
  }

  // ---------- handlers ----------

  async function handleMessage(msg) {
    const chatId = msg.chat?.id;
    const from = msg.from;
    if (!chatId || !from) return;

    const tgId = String(from.id);
    const username = from.username ? "@" + from.username : "";
    const name = [from.first_name || "", from.last_name || ""].join(" ").trim();
    await upsertUser(tgId, username, name);

    const text = ((msg.text || "").trim()).replace(/\s+/g, " ");

    if (/^\/start(@\w+)?(\s|$)/i.test(text)) {
      const botName = publicName || "Кооп-бот";
      const welcome =
        `Привет! Я ${botName} 🤝\n\n` +
        `Я помогаю сокланам быстро находить напарника для коопа.\n\n` +
        `Как это работает:\n` +
        `1) «🟢 Запросить кооп» — ты в очереди.\n` +
        `2) «🔵 Ответить на кооп» — выбираешь, на чей запрос откликнуться.\n` +
        `3) Автор запроса выбирает отклик — и я соединяю вас ✅\n\n` +
        `После успешного совпадения обоим +1 в статистику.\n\n` +
        `Совет: укажи игровой ник — тогда в списках будут игровые ники.\n` +
        `Команда: /nick ТВОЙ_НИК`;

      await sendMessage(chatId, welcome, await kbFor(tgId));
      return;
    }

    if (/^\/nick(@\w+)?(\s|$)/i.test(text)) {
      const nick = text.replace(/^\/nick(@\w+)?/i, "").trim();
      if (!nick) {
        await sendMessage(chatId, "Напиши так:\n/nick ТВОЙ_НИК", await kbFor(tgId));
        return;
      }
      await setGameNick(tgId, nick);
      await sendMessage(chatId, "Запомнил ✅ Теперь ты: " + nick, await kbFor(tgId));
      return;
    }

    await sendMessage(chatId, "Ок 🙂 Выбирай действие кнопками ниже 👇", await kbFor(tgId));
  }

  async function handleCallback(cq) {
    const data = String(cq.data || "");
    const from = cq.from;
    const msg = cq.message;
    if (!from || !msg) return;

    const chatId = msg.chat.id;
    const tgId = String(from.id);
    const username = from.username ? "@" + from.username : "";
    const name = [from.first_name || "", from.last_name || ""].join(" ").trim();
    await upsertUser(tgId, username, name);

    await answerCallback(cq.id);

    if (data === CB.SET_NICK || data === CB.CHANGE_NICK) {
      await sendMessage(chatId, "Пришли игровой ник так:\n/nick ТВОЙ_НИК", await kbFor(tgId));
      return;
    }

    if (data === CB.MY_STATS) {
      const u = await getUserBrief(tgId);
      const label = await displayName(tgId);
      const score = u ? Number(u.score || 0) : 0;
      const openReq = await findOpenRequestByRequester(tgId);
      const status = openReq ? "✅ Ты сейчас в очереди" : "⛔️ Ты сейчас не в очереди";
      await sendMessage(
        chatId,
        "📊 Твоя статистика\n\n" +
          "Ник: " + label + "\n" +
          "Очки: " + score + "\n" +
          status,
        await kbFor(tgId)
      );
      return;
    }

    if (data === CB.EXIT_QUEUE) {
      const openReq = await findOpenRequestByRequester(tgId);
      if (!openReq) {
        await sendMessage(chatId, "Ты сейчас не в очереди 🙂", await kbFor(tgId));
        return;
      }
      await closeRequestWithoutMatch(openReq.request_id);
      await rejectAllPendingForRequest(openReq.request_id, "Запрос закрылся. Не получилось законнектиться 😕");
      await sendMessage(chatId, "Снял тебя с очереди ✅", await kbFor(tgId));
      return;
    }

    if (data === CB.REQUEST_COOP) {
      const openReq = await findOpenRequestByRequester(tgId);
      if (openReq) {
        await sendMessage(
          chatId,
          "Ты уже в очереди ✅\nЖдём отклики. Как только кто-то ответит — я пришлю список.",
          await kbFor(tgId)
        );
        return;
      }
      const requestId = "R" + Date.now() + "_" + tgId;
      await createRequest(requestId, tgId);
      await sendMessage(
        chatId,
        "Готово ✅ Ты в очереди на кооп.\nСокланы смогут откликнуться через «Ответить на кооп».",
        await kbFor(tgId)
      );
      return;
    }

    if (data === CB.RESPOND_COOP) {
      const openRequests = await listOpenRequestsExcluding(tgId);
      if (!openRequests.length) {
        await sendMessage(chatId, "Сейчас нет активных запросов 😕\nМожешь зайти чуть позже.", await kbFor(tgId));
        return;
      }
      const kb = { inline_keyboard: [] };
      for (const r of openRequests.slice(0, 10)) {
        const label = await displayName(r.requester_id);
        kb.inline_keyboard.push([{ text: "🎮 Запрос: " + label, callback_data: `${CB.PICK_REQUEST}|${r.request_id}` }]);
      }
      kb.inline_keyboard.push([{ text: "✖️ Отмена", callback_data: CB.CANCEL }]);
      await sendMessage(chatId, "Выбери, на чей запрос откликнуться:", kb);
      return;
    }

    if (data.startsWith(CB.PICK_REQUEST + "|")) {
      const [, requestId] = data.split("|");
      const req = await getRequestById(requestId);
      if (!req || req.status !== REQUEST_STATUS.OPEN) {
        await sendMessage(chatId, "Этот запрос уже недоступен.", await kbFor(tgId));
        return;
      }
      if (String(req.requester_id) === String(tgId)) {
        await sendMessage(chatId, "На свой запрос отвечать нельзя 🙂", await kbFor(tgId));
        return;
      }

      const existing = await getResponse(requestId, tgId);
      if (existing && existing.status === RESPONSE_STATUS.PENDING) {
        await sendMessage(chatId, "Ты уже откликнулся. Ждём, кого выберут 👀", await kbFor(tgId));
        return;
      }
      if (existing && existing.status === RESPONSE_STATUS.REJECTED) {
        await sendMessage(chatId, "Твой прошлый отклик на этот запрос не прошёл. Выбери другой запрос.", await kbFor(tgId));
        return;
      }
      if (existing && existing.status === RESPONSE_STATUS.ACCEPTED) {
        await sendMessage(chatId, "Вы уже совпали по этому запросу ✅", await kbFor(tgId));
        return;
      }

      await createOrUpdateResponse(requestId, tgId, RESPONSE_STATUS.PENDING);
      await sendMessage(chatId, "Отклик отправлен ✅\nЖдём, выберет ли тебя игрок.", await kbFor(tgId));
      await notifyRequesterWithPendingResponders(req.requester_id, requestId);
      return;
    }

    if (data.startsWith(CB.PICK_RESPONDER + "|")) {
      const [, requestId, chosenResponderId] = data.split("|");

      const req = await getRequestById(requestId);
      if (!req) {
        await sendMessage(chatId, "Запрос уже недоступен.", await kbFor(tgId));
        return;
      }
      if (String(req.requester_id) !== String(tgId)) {
        await sendMessage(chatId, "Это не твой запрос 🙂", await kbFor(tgId));
        return;
      }
      if (req.status !== REQUEST_STATUS.OPEN) {
        await sendMessage(chatId, "Этот запрос уже закрыт.", await kbFor(tgId));
        return;
      }

      const resp = await getResponse(requestId, chosenResponderId);
      if (!resp || resp.status !== RESPONSE_STATUS.PENDING) {
        await sendMessage(chatId, "Этот отклик уже недоступен. Выбери другого.", await kbFor(tgId));
        await notifyRequesterWithPendingResponders(tgId, requestId);
        return;
      }

      await closeMatch(requestId, tgId, chosenResponderId);

      const requesterLabel = await displayName(tgId);
      const responderLabel = await displayName(chosenResponderId);

      await sendMessage(tgId, "Супер ✅ Матч найден!\nТвой напарник: " + responderLabel + "\nУдачной катки 🎮", await kbFor(tgId));
      await sendMessage(chosenResponderId, "Есть коннект ✅\nТы идёшь в кооп с: " + requesterLabel + "\nУдачной катки 🎮", await kbFor(chosenResponderId));

      await notifyAdminMatch(tgId, chosenResponderId);
      await notifyRejectedResponders(requestId, chosenResponderId);
      return;
    }

    if (data === CB.CANCEL) {
      await sendMessage(chatId, "Окей, отменил 👍", await kbFor(tgId));
      return;
    }

    await sendMessage(chatId, "Не понял действие. Попробуй снова.", await kbFor(tgId));
  }

  return { handleMessage, handleCallback };
}

// helpers
function col_(zeroIdx) {
  // 0->A, 25->Z, 26->AA
  let n = zeroIdx + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

module.exports = { buildBot };
