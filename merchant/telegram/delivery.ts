import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { TelegramAPIError, type TelegramAPI } from "./api";

type Context = {
  key: string;
  index: number;
};

type DeliveryRecord = {
  _id: string;
  fingerprint: string;
  state: "sending" | "sent" | "retry" | "unknown_delivery" | "failed";
  messageId?: number;
  createdAt: Date;
};

export function createDurableTelegram(
  db: Db,
  transport: TelegramAPI,
  botKey: string,
) {
  const context = new AsyncLocalStorage<Context>();

  const records = db.collection<DeliveryRecord>("merchant_telegram_deliveries");

  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");

  const sendMessage: TelegramAPI["sendMessage"] = async (
    chatId,
    text,
    buttons,
  ) => {
    const current = context.getStore();

    if (!current) {
      return transport.sendMessage(chatId, text, buttons);
    }

    const id = hash(`${botKey}:${current.key}:${current.index++}`);

    const fingerprint = hash(JSON.stringify([chatId, text, buttons ?? null]));

    let owned = false;

    try {
      await records.insertOne({
        _id: id,
        fingerprint,
        state: "sending",
        createdAt: new Date(),
      });

      owned = true;
    } catch (error) {
      const duplicate =
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000;

      if (!duplicate) throw error;
    }

    if (!owned) {
      const previous = await records.findOne({ _id: id });

      if (!previous || previous.fingerprint !== fingerprint) {
        throw new TelegramAPIError("unknown_delivery");
      }

      if (previous.state === "sent" && previous.messageId !== undefined) {
        return { message_id: previous.messageId };
      }

      if (previous.state === "failed") {
        throw new TelegramAPIError("rejected");
      }

      if (previous.state !== "retry") {
        throw new TelegramAPIError("unknown_delivery");
      }

      const claim = await records.updateOne(
        { _id: id, state: "retry", fingerprint },
        { $set: { state: "sending" } },
      );

      if (!claim.modifiedCount) {
        throw new TelegramAPIError("unknown_delivery");
      }
    }

    let sent: { message_id: number };

    try {
      sent = await transport.sendMessage(chatId, text, buttons);
    } catch (error) {
      const rateLimit =
        error instanceof TelegramAPIError && error.code === "rate_limit";

      const rejected =
        error instanceof TelegramAPIError &&
        ["rejected", "unauthorized", "conflict"].includes(error.code);

      await records
        .updateOne(
          { _id: id, state: "sending" },
          {
            $set: {
              state: rateLimit
                ? "retry"
                : rejected
                  ? "failed"
                  : "unknown_delivery",
            },
          },
        )
        .catch(() => undefined);

      if (rateLimit || rejected) throw error;

      throw new TelegramAPIError("unknown_delivery");
    }

    // Зөвхөн хадгалалтыг давтана. Дахин мессеж явуулахгүй.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const saved = await records.updateOne(
          { _id: id, fingerprint },
          {
            $set: {
              state: "sent",
              messageId: sent.message_id,
            },
          },
        );

        if (saved.matchedCount !== 1) {
          throw new Error("Delivery record missing");
        }

        return sent;
      } catch {
        if (attempt === 2) {
          throw new TelegramAPIError("unknown_delivery");
        }
      }
    }

    throw new TelegramAPIError("unknown_delivery");
  };

  const api: TelegramAPI = {
    sendMessage,
    getMe: () => transport.getMe(),
    getUpdates: (offset, signal) => transport.getUpdates(offset, signal),
    deleteWebhook: () => transport.deleteWebhook(),
    setWebhook: (url, secret) => transport.setWebhook(url, secret),
    answerCallbackQuery: (id, text) => transport.answerCallbackQuery(id, text),
    getWebhookInfo: () => transport.getWebhookInfo(),
  };

  return {
    api,
    run: <T>(key: string, work: () => Promise<T>) =>
      context.run({ key, index: 0 }, work),
  };
}
