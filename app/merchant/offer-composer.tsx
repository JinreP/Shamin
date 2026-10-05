"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { RFQ } from "@/shared/merchant-contracts";
import { repairQuoteNegotiationPolicySchema, type DashboardSnapshot } from "@/merchant/private-contracts";
import { localizeKnownText, statusLabel } from "@/merchant/i18n";
import styles from "./dashboard.module.css";

type OfferLine = { resourceId: string; quantity: string; price: string; available: string };
type Props = {
  rfq: RFQ;
  snapshot: DashboardSnapshot;
  busy: boolean;
  telegramConnected: boolean;
  onConnectTelegram: () => void;
};

const moneyFormat = new Intl.NumberFormat("mn-MN");
const moneyLabel = (amountMinor: number) => `${moneyFormat.format(amountMinor / 100)} ₮`;
const timeLabel = (iso: string) => new Date(iso).toLocaleString("mn-MN", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
});

// These are entered prices, never assessment amounts or saved catalog prices.
function enteredMoney(value: string): { amountMinor: number; currency: "MNT" } | null {
  if (!/^\d+$/.test(value)) return null;
  const amountMinor = Number(value) * 100;
  return Number.isSafeInteger(amountMinor) ? { amountMinor, currency: "MNT" } : null;
}

function deadlinePassed(deadlines: (string | undefined)[]) {
  const currentTime = Date.now();
  return deadlines.some(deadline => deadline && Date.parse(deadline) <= currentTime) ? currentTime : null;
}

export default function MerchantOfferComposer({ rfq, snapshot, busy, telegramConnected, onConnectTelegram }: Props) {
  const id = useId();
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const [lines, setLines] = useState<OfferLine[]>(() => rfq.items.map(item => ({
    resourceId: "", quantity: String(item.quantity), price: "", available: "",
  })));
  const [slotId, setSlotId] = useState("");
  const [partsMode, setPartsMode] = useState("");
  const [partsPrice, setPartsPrice] = useState("");
  const [customerParts, setCustomerParts] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [floorPrice, setFloorPrice] = useState("");
  const [humanApprovalBelow, setHumanApprovalBelow] = useState("");
  const [automaticNegotiation, setAutomaticNegotiation] = useState("");
  const [maxRounds, setMaxRounds] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "fallback">("idle");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const repair = rfq.kind === "repair";
  const repairShop = snapshot.profile.record.kind === "repair";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const resources = repair ? snapshot.services.map(entry => entry.record) : snapshot.inventory.map(entry => entry.record);
  const activeResources = resources.filter(resource => resource.active && resource.merchantId === rfq.merchantId);
  const selectedResources = lines.map(line => activeResources.find(resource => resource.id === line.resourceId));
  const serviceDuration = selectedResources.reduce((sum, resource, index) =>
    sum + (resource && "durationMinutes" in resource ? resource.durationMinutes * Number(lines[index].quantity) : 0), 0);
  const slots = snapshot.slots.map(entry => entry.record).filter(slot =>
    slot.merchantId === rfq.merchantId && slot.status === "available" && slot.capacity > 0 &&
    Date.parse(slot.startsAt) > now &&
    selectedResources.every(resource => !resource || slot.serviceIds.includes(resource.id)) &&
    Date.parse(slot.endsAt) - Date.parse(slot.startsAt) >= serviceDuration * 60000 &&
    (!rfq.requiredBy || Date.parse(slot.endsAt) <= Date.parse(rfq.requiredBy)));
  const selectedSlot = slots.find(slot => slot.id === slotId);
  const expired = rfq.status === "expired" || Boolean(rfq.requiredBy && Date.parse(rfq.requiredBy) <= now);
  const unavailableRequest = rfq.status === "declined";
  const linePrices = lines.map(line => enteredMoney(line.price));
  const laborTotal = linePrices.reduce((sum, price, index) => sum + (price?.amountMinor ?? 0) * Number(lines[index].quantity), 0);
  const suppliedPartsPrice = partsMode === "priced" ? enteredMoney(partsPrice) : null;
  const total = laborTotal + (suppliedPartsPrice?.amountMinor ?? 0);
  const validMoneyTotal = Number.isSafeInteger(total) && total >= 0;
  const completeLines = lines.length > 0 && lines.length <= 100 && lines.every((line, index) => {
    const quantity = Number(line.quantity);
    return selectedResources[index] && linePrices[index] && /^\d+$/.test(line.quantity) &&
      Number.isSafeInteger(quantity) && quantity > 0 && quantity <= rfq.items[index].quantity && quantity <= 10000 &&
      line.available === "true";
  });
  const policy = repairQuoteNegotiationPolicySchema.safeParse({
    floorPrice: enteredMoney(floorPrice),
    humanApprovalBelow: humanApprovalBelow === "" ? null : enteredMoney(humanApprovalBelow),
    automaticNegotiationEnabled: automaticNegotiation === "true" ? true : automaticNegotiation === "false" ? false : null,
    maxRounds: Number(maxRounds),
  });
  const policyValid = policy.success && policy.data.floorPrice.amountMinor <= total &&
    (humanApprovalBelow === "" || (enteredMoney(humanApprovalBelow) !== null && policy.data.humanApprovalBelow !== null &&
      policy.data.humanApprovalBelow.amountMinor >= policy.data.floorPrice.amountMinor));
  const repairComplete = !repair || Boolean(selectedSlot && (partsMode === "none" || suppliedPartsPrice) &&
    (customerParts === "true" || (partsMode === "priced" && customerParts === "false")) && policyValid);
  const draftComplete = completeLines && validMoneyTotal && repairComplete;

  const text = [
    `ХҮНИЙ ҮНИЙН САНАЛ\nХүсэлтийн дугаар: ${rfq.id}\nМашин: ${rfq.vehicle.make} ${rfq.vehicle.model}${rfq.vehicle.year ? ` (${rfq.vehicle.year})` : ""}`,
    ...lines.map((line, index) => {
      const resource = selectedResources[index];
      return [
        `${index + 1}-р мөр (itemIndex=${index}): ${rfq.items[index].description}`,
        `Сонгосон ${repair ? "үйлчилгээ" : "сэлбэг"}: ${resource?.name ?? "Сонгоогүй"}; resourceId=${line.resourceId || "Сонгоогүй"}`,
        `Тоо ширхэг: ${line.quantity || "Оруулаагүй"}; ${repair ? "Нэгж ажлын хөлс" : "Нэгж үнэ"}: ${line.price || "Оруулаагүй"} төгрөг (MNT)`,
        `Боломжтой эсэх: ${line.available === "true" ? "Бэлэн, боломжтой (available=true)" : line.available === "false" ? "Боломжгүй (available=false)" : "Сонгоогүй"}`,
        ...(resource && "condition" in resource ? [`Сэлбэгийн төлөв: ${statusLabel(resource.condition)} (condition=${resource.condition})`] : []),
        `Баталгаа: ${resource?.warranty ?? "Сонгоогүй"}`,
      ].join("\n");
    }),
    ...(repair ? [
      `ЗАСВАРЫН САНАЛ\nАжлын хөлс (laborPrice): ${draftComplete ? String(laborTotal / 100) : linePrices.every(Boolean) && Number.isSafeInteger(laborTotal) ? String(laborTotal / 100) : "Оруулаагүй"} төгрөг (MNT)`,
      partsMode === "none" ? "Сэлбэг санал болгохгүй; сэлбэгийн үнэ байхгүй (partsPrice=null)." :
        partsMode === "priced" ? `Сэлбэгийн үнэ (partsPrice): ${partsPrice || "Оруулаагүй"} төгрөг (MNT)` : "Сэлбэгийн үнийн төлөв: Сонгоогүй",
      `Захиалагч өөрийн сэлбэг авчрахыг зөвшөөрөх эсэх: ${customerParts === "true" ? "Зөвшөөрнө (customerSuppliedPartsAccepted=true)" : customerParts === "false" ? "Зөвшөөрөхгүй (customerSuppliedPartsAccepted=false)" : "Сонгоогүй"}`,
      `Тооцоолсон хугацаа: ${duration.trim() || "Тодорхойлоогүй"}`,
      `Сонгосон засварын цаг: ${selectedSlot ? `${timeLabel(selectedSlot.startsAt)} — ${timeLabel(selectedSlot.endsAt)}; slotId=${selectedSlot.id}` : "Сонгоогүй"}`,
      ...(selectedSlot ? [`Хамгийн эрт эхлэх цаг (earliestAvailableAt): ${selectedSlot.startsAt}`] : []),
      `Тайлбар: ${notes.trim() || "Нэмэлт тайлбаргүй"}`,
      `ХУВИЙН ХЭЛЭЛЦЭЭНИЙ БОДЛОГО — зөвхөн худалдаачны ботод, худалдан авагчид нийтлэхгүй\nХувийн доод үнэ (floorPrice): ${floorPrice || "Оруулаагүй"} төгрөг (MNT)`,
      humanApprovalBelow === "" ? "Хүний зөвшөөрөх босго байхгүй (humanApprovalBelow=null)." : `Хүний зөвшөөрөх босго (humanApprovalBelow): ${humanApprovalBelow} төгрөг (MNT)`,
      `Автомат хэлэлцээ зөвшөөрөх эсэх: ${automaticNegotiation === "true" ? "Зөвшөөрнө (automaticNegotiationEnabled=true)" : automaticNegotiation === "false" ? "Зөвшөөрөхгүй (automaticNegotiationEnabled=false)" : "Сонгоогүй"}`,
      `Хэлэлцээний дээд оролдлого (maxRounds): ${maxRounds || "Сонгоогүй"}`,
    ] : []),
  ].join("\n\n");
  const tooLong = text.length > 6000;
  const canCopy = draftComplete && !expired && !unavailableRequest && !busy && !tooLong;
  const hasAllPrices = linePrices.every(Boolean) && validMoneyTotal;

  function updateLine(index: number, field: keyof OfferLine, value: string) {
    setLines(current => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
    if (field === "resourceId" || field === "quantity") setSlotId("");
  }

  const handleCopyOffer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canCopy) return;
    // Recheck the clock only in this user event, between timer ticks.
    const elapsedAt = deadlinePassed([rfq.requiredBy, repair ? selectedSlot?.startsAt : undefined]);
    if (elapsedAt !== null || (repair && !selectedSlot)) {
      if (elapsedAt !== null) setNow(elapsedAt);
      return;
    }
    if (repairShop) {
      setPreviewOpen(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("fallback");
      setPreviewOpen(true);
      window.requestAnimationFrame(() => {
        previewRef.current?.focus();
        previewRef.current?.select();
      });
    }
  };

  return <section className={styles.offerCard} aria-labelledby={`${id}-title`}>
    <div className={styles.sectionHead}><div><h2 id={`${id}-title`}>Танай санал</h2><p className={styles.muted}>{repairShop ? "Өөрийн үнэ, нөхцөлөө оруулаад саналаа урьдчилан хараарай." : "Өөрийн үнэ, нөхцөлөө оруулаад Telegram-д шалгаж баталгаажуулна."}</p></div><span className={styles.privateBadge}>Хувийн ноорог</span></div>
    <form onSubmit={handleCopyOffer} onChange={() => setCopyStatus("idle")}>
      <fieldset disabled={busy || expired || unavailableRequest} className={styles.formSection}>
        <legend>{repair ? "Ажлын үнэ" : "Сэлбэгийн үнэ"}</legend>
        <p className={styles.helperText}>Үнийг өөрөө оруулна уу. Үнэлгээний баримт болон бүртгэлийн үнийг автоматаар ашиглахгүй.</p>
        {lines.map((line, index) => {
          const resource = selectedResources[index];
          return <fieldset key={index} className={styles.formSection}>
            <legend>{index + 1}. {rfq.items[index].description}</legend>
            <div className={styles.formGrid}>
              <label>{repair ? "Үйлчилгээ" : "Сэлбэг"}<select required value={line.resourceId} onChange={event => updateLine(index, "resourceId", event.target.value)}><option value="">Сонгох…</option>{activeResources.map(record => <option key={record.id} value={record.id}>{localizeKnownText(record.name, repair ? "Засварын үйлчилгээ" : "Сэлбэг")} · {record.id}</option>)}</select></label>
              <label>Тоо ширхэг<input required type="number" inputMode="numeric" min="1" max={Math.min(rfq.items[index].quantity, 10000)} step="1" value={line.quantity} onChange={event => updateLine(index, "quantity", event.target.value)} /></label>
              <label>{repair ? "Нэгж ажлын хөлс" : "Нэгж үнэ"} (₮)<input className={styles.moneyField} required type="number" inputMode="numeric" min="0" step="1" placeholder="Үнэ оруулах" value={line.price} onChange={event => updateLine(index, "price", event.target.value)} /></label>
              <label>Боломжтой эсэх<select required value={line.available} onChange={event => updateLine(index, "available", event.target.value)}><option value="">Сонгох…</option><option value="true">Бэлэн, боломжтой</option><option value="false">Боломжгүй</option></select></label>
            </div>
            {resource && <p className={styles.helperText}>{"condition" in resource ? `${statusLabel(resource.condition)} · Нөөц: ${resource.stock} · ` : ""}Баталгаа: {localizeKnownText(resource.warranty, "Бүртгэлийн баталгааны нөхцөл")}{"customerPartsTerms" in resource ? ` · ${localizeKnownText(resource.customerPartsTerms, "Бүртгэлийн сэлбэгийн нөхцөл")}` : ""}</p>}
          </fieldset>;
        })}
        {activeResources.length === 0 && <p className={styles.helperText}>Саналд сонгох идэвхтэй {repair ? "үйлчилгээ" : "сэлбэг"} бүртгэл алга. Эхлээд бүртгэлээ нэмнэ үү.</p>}
      </fieldset>

      {repair && <>
        <fieldset disabled={busy || expired || unavailableRequest} className={styles.formSection}>
          <legend>Сэлбэг ба хугацаа</legend>
          <fieldset className={styles.choiceGroup}><legend>Сэлбэгийн үнэ</legend><label className={styles.choice}><input required type="radio" name={`${id}-parts`} value="none" checked={partsMode === "none"} onChange={() => setPartsMode("none")} />Сэлбэг санал болгохгүй</label><label className={styles.choice}><input required type="radio" name={`${id}-parts`} value="priced" checked={partsMode === "priced"} onChange={() => setPartsMode("priced")} />Сэлбэгийн үнэ санал болгоно</label></fieldset>
          {partsMode === "priced" && <label>Сэлбэгийн үнэ (₮)<input required className={styles.moneyField} type="number" inputMode="numeric" min="0" step="1" placeholder="Сэлбэгийн үнэ оруулах" value={partsPrice} onChange={event => setPartsPrice(event.target.value)} /></label>}
          {partsMode === "none" && <p className={styles.helperText}>Сэлбэгийн үнэ саналгүй. Энэ нь 0 ₮ гэсэн утга биш.</p>}
          <div className={styles.formGrid}>
            <label>Сэлбэгээ өөрөө авчирч болох эсэх<select required value={customerParts} onChange={event => setCustomerParts(event.target.value)}><option value="">Сонгох…</option><option value="true">Тийм, зөвшөөрнө</option><option value="false">Үгүй, зөвшөөрөхгүй</option></select></label>
            <label>Засварын хугацаа (заавал биш)<input maxLength={200} placeholder="Жишээ: 2 ажлын өдөр" value={duration} onChange={event => setDuration(event.target.value)} /></label>
            <label>Хамгийн ойрын боломжит цаг<select required value={selectedSlot ? slotId : ""} onChange={event => setSlotId(event.target.value)}><option value="">Бүртгэлтэй сул цагаас сонгох…</option>{slots.map(slot => <option key={slot.id} value={slot.id}>{timeLabel(slot.startsAt)} — {timeLabel(slot.endsAt)}</option>)}</select></label>
          </div>
          {slots.length === 0 && <p className={styles.helperText}>Сонгосон үйлчилгээнд тохирох ирээдүйн сул цаг алга. Цагийн бүртгэлээ шалгана уу.</p>}
          {partsMode === "none" && customerParts === "false" && <p className={styles.error} role="alert">Сэлбэг саналгүй үед захиалагчийн авчрах сэлбэгийг зөвшөөрөх шаардлагатай.</p>}
          <label>Нэмэлт тайлбар (заавал биш)<textarea maxLength={4000} rows={3} placeholder="Жишээ: Гуперийг засаж будна. Задалж үзсэний дараа нэмэлт ажил гарвал захиалагчтай тохирно." value={notes} onChange={event => setNotes(event.target.value)} /></label>
        </fieldset>

        <fieldset disabled={busy || expired || unavailableRequest} className={styles.formSection}>
          <legend>Үнийн тохиролцооны тохиргоо <span className={styles.privateBadge}>🔒 Зөвхөн танд харагдана</span></legend>
          <p className={styles.helperText}>{repairShop ? "Agent таны тохируулсан хязгаар дотор үнэ тохиролцоно." : "Энэ саналын дотоод хязгаар. Telegram дахь худалдаачны ботод очно; худалдан авагчийн саналд нийтлэгдэхгүй."}</p>
          <div className={styles.formGrid}>
            <label>Хувийн доод үнэ (₮)<input required className={styles.moneyField} type="number" inputMode="numeric" min="0" step="1" placeholder="Доод үнэ оруулах" value={floorPrice} onChange={event => setFloorPrice(event.target.value)} /></label>
            <label>Үүнээс доош бол хүний зөвшөөрөл (₮)<input className={styles.moneyField} type="number" inputMode="numeric" min="0" step="1" placeholder="Босгогүй бол хоосон үлдээнэ" value={humanApprovalBelow} onChange={event => setHumanApprovalBelow(event.target.value)} /></label>
            <label>Автомат хэлэлцээ зөвшөөрөх үү?<select required value={automaticNegotiation} onChange={event => setAutomaticNegotiation(event.target.value)}><option value="">Сонгох…</option><option value="true">Тийм, зөвшөөрнө</option><option value="false">Үгүй, зөвшөөрөхгүй</option></select></label>
            <label>Хэлэлцээний дээд оролдлого<select required value={maxRounds} onChange={event => setMaxRounds(event.target.value)}><option value="">Сонгох…</option>{[1, 2, 3, 4, 5].map(round => <option key={round} value={round}>{round} удаа</option>)}</select></label>
          </div>
          {enteredMoney(floorPrice) && hasAllPrices && enteredMoney(floorPrice)!.amountMinor > total && <p className={styles.error} role="alert">Доод үнэ саналын нийт үнээс хэтэрч болохгүй.</p>}
          {enteredMoney(humanApprovalBelow) && enteredMoney(floorPrice) && enteredMoney(humanApprovalBelow)!.amountMinor < enteredMoney(floorPrice)!.amountMinor && <p className={styles.error} role="alert">Хүний зөвшөөрөх босго доод үнээс бага байж болохгүй.</p>}
        </fieldset>
      </>}

      <div className={styles.offerTotal} aria-live="polite">
        <span>{repair ? "Ажлын үнэ" : "Сэлбэгийн дүн"}</span><strong>{hasAllPrices ? moneyLabel(laborTotal) : "Үнэ оруулаагүй"}</strong>
        {repair && <><span>Сэлбэгийн үнэ</span><strong>{partsMode === "none" ? "Саналгүй" : suppliedPartsPrice ? moneyLabel(suppliedPartsPrice.amountMinor) : "Сонгоогүй"}</strong><span>Нийт санал</span><strong>{hasAllPrices && (partsMode === "none" || suppliedPartsPrice) ? moneyLabel(total) : "Дутуу байна"}</strong></>}
      </div>
      {!repairShop && <details className={styles.technicalDetails} open={previewOpen} onToggle={event => setPreviewOpen(event.currentTarget.open)}><summary>Telegram-д хуулах саналаа шалгах</summary><label htmlFor={`${id}-preview`}>Худалдаачны хувийн мессеж</label><textarea ref={previewRef} id={`${id}-preview`} className={styles.offerPreview} readOnly rows={12} value={text} onFocus={event => event.currentTarget.select()} /><p className={styles.helperText}>{text.length.toLocaleString("mn-MN")} / 6,000 тэмдэгт</p></details>}
      {tooLong && <p className={styles.error} role="alert">Мессеж 6,000 тэмдэгтээс хэтэрсэн байна. Тайлбарыг товчилно уу.</p>}
      {expired && <p className={styles.error} role="alert">Хүсэлтийн хүчинтэй хугацаа дууссан байна.</p>}
      {unavailableRequest && <p className={styles.error} role="alert">Энэ хүсэлтээс татгалзсан тул шинэ санал бэлтгэх боломжгүй.</p>}
      {!draftComplete && !expired && !unavailableRequest && <p className={styles.helperText}>Заавал бөглөх үнэ, боломж, {repair ? "цаг болон хувийн тохиргоог" : "сэлбэгийн сонголтыг"} гүйцээнэ үү. Боломжгүй мөртэй санал баталгаажихгүй.</p>}
      {repairShop ? <>
        <p className={styles.helperText}>Санал бэлдэх болон урьдчилан харах үйлдэл саналыг илгээхгүй. Тохиролцооны хувийн тохиргоо саналын урьдчилсан харагдацад орохгүй.</p>
        <div className={styles.inlineActions}><button type="submit" disabled={!canCopy}>Санал бэлдэх</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => setPreviewOpen(true)}>Урьдчилан харах</button></div>
        <details className={styles.offerPreview} open={previewOpen} onToggle={event => setPreviewOpen(event.currentTarget.open)}>
          <summary>Саналын урьдчилсан харагдац</summary>
          <h3>{rfq.vehicle.make} {rfq.vehicle.model}{rfq.vehicle.year ? ` (${rfq.vehicle.year})` : ""} · Засварын санал</h3>
          <dl>
            <div><dt>Ажлын үнэ</dt><dd>{hasAllPrices ? moneyLabel(laborTotal) : "Үнэ оруулаагүй"}</dd></div>
            <div><dt>Сэлбэгийн үнэ</dt><dd>{partsMode === "none" ? "Саналгүй" : suppliedPartsPrice ? moneyLabel(suppliedPartsPrice.amountMinor) : "Сонгоогүй"}</dd></div>
            <div><dt>Сэлбэгээ өөрөө авчирч болох эсэх</dt><dd>{customerParts === "true" ? "Тийм, зөвшөөрнө" : customerParts === "false" ? "Үгүй, зөвшөөрөхгүй" : "Сонгоогүй"}</dd></div>
            <div><dt>Засварын хугацаа</dt><dd>{duration.trim() || "Тодорхойлоогүй"}</dd></div>
            <div><dt>Хамгийн ойрын боломжит цаг</dt><dd>{selectedSlot ? timeLabel(selectedSlot.startsAt) : "Сонгоогүй"}</dd></div>
            <div><dt>Нэмэлт тайлбар</dt><dd>{notes.trim() || "Нэмэлт тайлбаргүй"}</dd></div>
          </dl>
          <div className={styles.offerTotal}><span>Нийт санал</span><strong>{hasAllPrices && (partsMode === "none" || suppliedPartsPrice) ? moneyLabel(total) : "Дутуу байна"}</strong></div>
          <p className={styles.helperText}>Энэ нь урьдчилсан харагдац. Санал хараахан илгээгдээгүй.</p>
        </details>
      </> : <>
        {!telegramConnected && <div className={styles.inlineActions}><p className={styles.helperText}>Telegram холбогдоогүй байна. Бэлтгэсэн саналаа хуулж болно; ботод үргэлжлүүлэхийн өмнө холбоно уу.</p><button type="button" disabled={busy} onClick={onConnectTelegram}>Telegram холбох</button></div>}
        <p className={styles.helperText}>Хуулсны дараа худалдаачны Telegram бот дахь {rfq.id} хүсэлтийн «Хариу өгөх» товчийг сонгож, мессежээ илгээнэ үү. Ботын нооргийг шалгаад «Баталгаажуулах» товчийг дарна. Хуулах үйлдэл саналыг илгээхгүй, нийтлэхгүй.</p>
        <button type="submit" disabled={!canCopy}>Саналаа хуулаад Telegram-д үргэлжлүүлэх</button>
        {copyStatus === "copied" && <p className={styles.success} role="status">Саналыг хууллаа. Telegram-д тохирох хүсэлтээ сонгож илгээсний дараа шалгаж баталгаажуулна уу. Санал хараахан илгээгдээгүй.</p>}
        {copyStatus === "fallback" && <p className={styles.error} role="alert">Автоматаар хуулж чадсангүй. Дээрх сонгогдсон мессежийг гараар хуулаад Telegram-д үргэлжлүүлнэ үү.</p>}
      </>}
    </form>
  </section>;
}
