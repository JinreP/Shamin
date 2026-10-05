"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import styles from "../../dashboard.module.css";

type ApprovalPageData = {
  transactionId: string;
  merchantNames: string[];
  total: { amountMinor: number; currency: string };
  booking?: { startsAt: string; endsAt: string; customerSuppliedParts: boolean };
  expiresAt: string;
  status: "pending" | "verified" | "expired" | "revoked";
  quoteSummaries: { merchantName: string; quoteId: string; revision: number; kind: "parts" | "repair"; terms: string;
    repairEstimate?: { laborPrice: { amountMinor: number; currency: string }; partsPrice: { amountMinor: number; currency: string } | null;
      totalPrice: { amountMinor: number; currency: string }; customerSuppliedPartsAccepted: boolean;
      estimatedDuration: string | null; earliestAvailableAt?: string | null; notes?: string | null } }[];
};

export default function BuyerApprovalPage() {
  const { challenge } = useParams<{ challenge: string }>();
  const [approval, setApproval] = useState<ApprovalPageData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/merchant/approval/${encodeURIComponent(challenge)}`, { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Зөвшөөрлийн мэдээллийг ачаалж чадсангүй.");
        if (active) setApproval(data);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Зөвшөөрлийн мэдээллийг ачаалж чадсангүй."); });
    return () => { active = false; };
  }, [challenge]);

  async function decide(action: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/merchant/approval/${encodeURIComponent(challenge)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Үйлдлийг баталгаажуулж чадсангүй.");
      setApproval(current => current ? { ...current, status: action === "approve" ? "verified" : "revoked" } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Үйлдлийг баталгаажуулж чадсангүй.");
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.dashboard} lang="mn">
    <header className={styles.header}><div><span className={styles.eyebrow}>ЗАХАГЕНТ / ХУДАЛДАН АВАГЧИЙН ЗӨВШӨӨРӨЛ</span><h1>Захиалгын нөхцөл батлах</h1>
      <p>Зөвхөн шалгасны дараа өөрөө сонгож батална уу. Энэ нь туршилтын зөвшөөрөл бөгөөд бодит төлбөр хийхгүй.</p></div></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {!approval ? <p>Зөвшөөрлийн мэдээллийг шалгаж байна…</p> : <section className={styles.panel}>
      <h2>Нийт дүн: {approval.total.currency} {(approval.total.amountMinor / 100).toLocaleString("mn-MN")}</h2>
      <p>Гүйлгээний дугаар: {approval.transactionId}</p>
      <p>Худалдаачин: {approval.merchantNames.join(", ")}</p>
      <p>Дуусах хугацаа: {new Date(approval.expiresAt).toLocaleString("mn-MN")}</p>
      {approval.quoteSummaries.map(quote => <article key={`${quote.quoteId}-${quote.revision}`}>
        <h3>{quote.kind === "parts" ? "Сэлбэгийн үнийн санал" : "Засварын үнийн санал"} · {quote.merchantName}</h3>
        <p>Үнийн санал {quote.quoteId}, хувилбар {quote.revision}</p>
        <p>{quote.terms}</p>
        {quote.repairEstimate && <>
          <p>Засварын ажлын үнэ: {quote.repairEstimate.laborPrice.currency} {(quote.repairEstimate.laborPrice.amountMinor / 100).toLocaleString("mn-MN")}</p>
          <p>Сэлбэгийн үнэ: {quote.repairEstimate.partsPrice === null ? "— · саналд сэлбэг ороогүй" :
            `${quote.repairEstimate.partsPrice.currency} ${(quote.repairEstimate.partsPrice.amountMinor / 100).toLocaleString("mn-MN")}`}</p>
          {quote.repairEstimate.partsPrice === null && <p>Захиалагч сэлбэгээ авчрахыг засварчин зөвшөөрсөн: {quote.repairEstimate.customerSuppliedPartsAccepted ? "Тийм" : "Үгүй"}</p>}
          <p>Эцсийн засварын санал: {quote.repairEstimate.totalPrice.currency} {(quote.repairEstimate.totalPrice.amountMinor / 100).toLocaleString("mn-MN")}</p>
          {quote.repairEstimate.estimatedDuration && <p>Засварын хугацаа: {quote.repairEstimate.estimatedDuration}</p>}
          {quote.repairEstimate.notes && <p>{quote.repairEstimate.notes}</p>}
        </>}
      </article>)}
      {approval.booking && <><p>Засварын цаг: {new Date(approval.booking.startsAt).toLocaleString("mn-MN")} – {new Date(approval.booking.endsAt).toLocaleString("mn-MN")}</p>
        <p>Захиалагч өөрийн сэлбэг авчрах: {approval.booking.customerSuppliedParts ? "Тийм" : "Үгүй"}</p></>}
      <p>Төлөв: {approval.status === "pending" ? "Таны сонголтыг хүлээж байна" : approval.status === "verified" ? "Баталгаажсан" : approval.status === "expired" ? "Хугацаа дууссан" : "Цуцлагдсан"}</p>
      {approval.status === "pending" && <div className={styles.tabs}>
        <button disabled={busy} onClick={() => void decide("approve")}>{busy ? "Боловсруулж байна…" : "Зөвшөөрөх"}</button>
        <button disabled={busy} className={styles.secondary} onClick={() => void decide("reject")}>Татгалзах</button>
      </div>}
    </section>}
  </main>;
}
