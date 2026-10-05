"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { z } from "zod";
import { demoPaymentResponseSchema } from "@/lib/buyer-payment-types";
import styles from "./buyer-market.module.css";

type Result = z.infer<typeof demoPaymentResponseSchema>;

const money = (value: number) => `${value.toLocaleString("mn-MN")}₮`;

async function call(searchId: string, body?: object): Promise<Result> {
  const response = await fetch(`/api/buyer/payment?searchId=${searchId}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify({ ...body, searchId }) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const raw: unknown = await response.json();

  if (!response.ok) {
    const error = raw as { error?: unknown };

    throw new Error(
      typeof error?.error === "string"
        ? error.error
        : "Төлбөрийн мэдээлэл авахад алдаа гарлаа.",
    );
  }

  return demoPaymentResponseSchema.parse(raw);
}

export default function BuyerDemoPayment({ searchId }: { searchId: string }) {
  const [data, setData] = useState<Result>({ payment: null });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    let active = true;

    call(searchId)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((error: unknown) => {
        if (active) {
          setError(error instanceof Error ? error.message : "Алдаа гарлаа.");
        }
      })
      .finally(() => {
        if (active) setBusy(false);
      });

    return () => {
      active = false;
    };
  }, [searchId]);

  async function run(body: object) {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setError("");

    try {
      setData(await call(searchId, body));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Алдаа гарлаа.");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  const payment = data.payment;

  function download() {
    if (!payment || payment.status !== "demo_paid") return;

    const text = [
      "ZahAgent — ТУРШИЛТЫН БАРИМТ",
      "Бодит төлбөр болон eBarimt биш.",
      "",
      payment.receiptId,
      payment.vehicle,
      `Багцын нийт үнэ: ${money(payment.total)}`,
      `Demo урьдчилгаа (30%): ${money(payment.deposit)}`,
      `Үлдэгдэл: ${money(payment.remaining)}`,
      `Огноо: ${payment.paidAt}`,
      "",
      "Бараа резервлээгүй.",
    ].join("\n");

    const url = URL.createObjectURL(
      new Blob([text], {
        type: "text/plain;charset=utf-8",
      }),
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = `${payment.receiptId}.txt`;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className={styles.card}>
      <h2>5. Урьдчилгаа төлбөр · DEMO</h2>
      <p>Бодит мөнгө шилжихгүй. Урьдчилгаа төлөх үйлдлийг туршина.</p>

      {error && <p role="alert">{error}</p>}

      {!payment && (
        <button disabled={busy} onClick={() => void run({ action: "create" })}>
          {busy ? "Уншиж байна…" : "30% урьдчилгааны QR үүсгэх"}
        </button>
      )}

      {payment && (
        <>
          <p>{payment.vehicle}</p>
          <p>
            Багцын нийт үнэ: <strong>{money(payment.total)}</strong>
          </p>
          <h3>Урьдчилгаа 30%: {money(payment.deposit)}</h3>
          <p>Үлдэгдэл: {money(payment.remaining)}</p>

          {payment.status === "pending" ? (
            <>
              {data.qr && (
                <Image
                  unoptimized
                  src={data.qr}
                  width={240}
                  height={240}
                  alt="Demo нэхэмжлэлийн QR"
                />
              )}

              <p>
                QR нь demo нэхэмжлэлийн мэдээлэл агуулна. Банкны аппын төлбөрийн
                QR биш.
              </p>

              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={approved}
                  disabled={busy}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                {money(payment.deposit)} урьдчилгааг туршилтаар батлахыг
                зөвшөөрч байна.
              </label>

              <button
                disabled={busy || !approved}
                onClick={() =>
                  void run({
                    action: "confirm",
                    approved: true,
                    approvedAmount: payment.deposit,
                  })
                }
              >
                {busy ? "Хадгалж байна…" : "Туршилтын төлбөр батлах"}
              </button>
            </>
          ) : (
            <div className={styles.notice}>
              <h3>✓ Demo урьдчилгаа баталгаажлаа</h3>

              <p style={{ overflowWrap: "anywhere" }}>
                Баримт: {payment.receiptId}
              </p>

              <p>
                {payment.paidAt &&
                  new Date(payment.paidAt).toLocaleString("mn-MN")}
              </p>

              <p>
                Энэ нь туршилтын баримт. Бодит төлбөр, eBarimt, барааны резерв
                биш.
              </p>

              <button onClick={download}>Баримт татах (.txt)</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
