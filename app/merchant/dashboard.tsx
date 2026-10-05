"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { DEMO_MERCHANTS } from "@/merchant/demo-merchants";
import { adminSchemas, type AdminResource, type DashboardSnapshot, type Versioned } from "@/merchant/private-contracts";
import { fieldLabels, localizeKnownText, localizedFieldPath, localizedAdminFields, merchantErrorMessage, statusLabel, validationMessage } from "@/merchant/i18n";
import type { Money, Quote, RFQ } from "@/shared/merchant-contracts";
import MerchantOfferComposer from "./offer-composer";
import styles from "./dashboard.module.css";

async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/merchant-demo/${path}`, { method, cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.fields ? `${merchantErrorMessage(String(data.error))}: ${data.fields.map((f: { path: string; message: string }) => `${localizedFieldPath(f.path)} ${validationMessage(f.message)}`).join("; ")}` : merchantErrorMessage(String(data.error)));
  return data;
}
type Tab = AdminResource | "activity" | "orders";
const labels: Record<Tab, string> = { profile: "Бизнесийн танилцуулга", inventory: "Сэлбэгийн нөөц", service: "Засварын үйлчилгээ", slot: "Боломжит цаг", settings: "Үнийн тохиролцооны тохиргоо", activity: "Шинэ хүсэлтүүд", orders: "Захиалга ба гүйцэтгэл" };
const enums: Record<string, string[]> = { condition: ["oem", "aftermarket", "used"], status: ["available", "blocked"], customerSuppliedParts: ["accepted", "inspection_required", "not_accepted"] };
const uiFieldLabels: Record<string, string> = {
  minimumPrice: "Хамгийн доод зөвшөөрөх үнэ", maxDiscountBps: "Хөнгөлөлтийн дээд хэмжээ (%)",
  negotiationEnabled: "Үнэ тохиролцох боломжтой", humanApprovalRequired: "Үнэ тохиролцох бүрд надаас зөвшөөрөл авах",
  automaticNegotiationEnabled: "Автомат үнэ тохиролцоо", maxNegotiationRounds: "Хамгийн их тохиролцох оролдлого",
  startsAt: "Эхлэх огноо, цаг", endsAt: "Дуусах огноо, цаг", partNumber: "Сэлбэгийн дугаар",
  customerSuppliedParts: "Үйлчлүүлэгч сэлбэгээ өөрөө авчирч болох уу?",
  customerPartsTerms: "Үйлчлүүлэгчийн авчирсан сэлбэгийн нөхцөл", capabilities: "Хийдэг ажил, нийлүүлдэг сэлбэг",
};
const fieldHelp: Record<string, string> = {
  minimumPrice: "🔒 Энэ үнэ хэрэглэгчид харагдахгүй. Үнэ тохиролцохдоо үүнээс доош орохгүй.",
  automaticNegotiationEnabled: "Туслах таны тохируулсан хязгаарын дотор үнэ тохиролцоно.",
  humanApprovalRequired: "Идэвхтэй үед шинэ тохиролцоог та өөрөө шалгаж зөвшөөрнө.",
  maxNegotiationRounds: "Хязгаарт хүрвэл дахин автоматаар тохиролцохгүй.",
  warranty: "Ямар хугацаанд, юунд баталгаа өгөхөө тодорхой бичнэ үү.",
  startsAt: "Таны төхөөрөмжийн орон нутгийн цагаар оруулна.", endsAt: "Таны төхөөрөмжийн орон нутгийн цагаар оруулна.",
};
function money(value: Money | undefined | null) {
  if (value == null) return "—";
  return `${value.currency === "MNT" ? "₮" : `${value.currency} `}${(value.amountMinor / 100).toLocaleString("mn-MN")}`;
}
function dateTime(value: string) { return new Date(value).toLocaleString("mn-MN", { dateStyle: "medium", timeStyle: "short" }); }
function businessName(name: string) { return localizeKnownText(name, name).replace(/\s*[—–]\s*ТУРШИЛТ$/, ""); }
function vehicleName(rfq: RFQ) { return `${rfq.vehicle.make} ${rfq.vehicle.model}${rfq.vehicle.year ? ` · ${rfq.vehicle.year}` : ""}`; }
function requestStatus(status: RFQ["status"]) { return status === "received" ? "Шинэ хүсэлт" : status === "quoted" ? "Санал илгээсэн" : statusLabel(status); }
function localDateInput(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function PublishedOffer({ quote }: { quote: Quote }) {
  const estimate = quote.repairEstimate;
  return <article className={styles.offerPreview}>
    <div className={styles.sectionHead}><h3>{quote.kind === "repair" ? "Танай засварын санал" : "Танай сэлбэгийн санал"}</h3><span className="tag">{statusLabel(quote.status)}</span></div>
    {estimate ? <dl>
      <div><dt>Ажлын үнэ</dt><dd>{money(estimate.laborPrice)}</dd></div>
      <div><dt>Сэлбэгийн үнэ</dt><dd>{estimate.partsPrice === null ? "— · Сэлбэг нийлүүлэхгүй" : money(estimate.partsPrice)}</dd></div>
      <div><dt>Сэлбэгээ өөрөө авчрах</dt><dd>{estimate.customerSuppliedPartsAccepted ? "Боломжтой" : "Боломжгүй"}</dd></div>
      <div><dt>Засварын хугацаа</dt><dd>{estimate.estimatedDuration ?? "Тодорхойлоогүй"}</dd></div>
      {estimate.earliestAvailableAt && <div><dt>Хамгийн ойрын боломжит цаг</dt><dd>{dateTime(estimate.earliestAvailableAt)}</dd></div>}
    </dl> : <dl>{quote.lines.map((line, index) => <div key={`${line.resourceId}-${index}`}><dt>{localizeKnownText(line.description, line.description)} · {line.quantity} ширхэг</dt><dd>{money(line.unitPrice)} / нэгж</dd></div>)}</dl>}
    <div className={styles.offerTotal}><span>Нийт санал</span><strong>{money(quote.total)}</strong></div>
    {estimate?.notes && <p className="report">{estimate.notes}</p>}
    <details className={styles.technicalDetails}><summary>Саналын нөхцөл, дугаар</summary><p className="report">{quote.terms}</p><p>Хүчинтэй хугацаа: {dateTime(quote.expiresAt)}</p><p>Саналын дугаар: {quote.id} · хувилбар {quote.revision}</p></details>
  </article>;
}

function RequestDetails({ rfq, offers }: { rfq: RFQ; offers: Quote[] }) {
  const assessment = rfq.kind === "repair" ? rfq.damageAssessment : undefined;
  return <>
    <section className={styles.requestDetail} aria-labelledby="request-title">
      <div className={styles.sectionHead}><span className="tag">{rfq.kind === "repair" ? "Засварын хүсэлт" : "Сэлбэгийн хүсэлт"}</span><span className={styles.statusBadge}>{requestStatus(rfq.status)}</span></div>
      <h2 id="request-title">{vehicleName(rfq)}</h2>
      <p className={styles.requestMeta}>Ирсэн: {dateTime(rfq.createdAt)}{rfq.requiredBy && <> · Хэрэгтэй хугацаа: {dateTime(rfq.requiredBy)}</>}</p>
      <h3>Машины мэдээлэл</h3>
      <dl className={styles.vehicleInfo}>
        <div><dt>Үйлдвэрлэгч</dt><dd>{rfq.vehicle.make}</dd></div>
        <div><dt>Загвар</dt><dd>{rfq.vehicle.model}</dd></div>
        {rfq.vehicle.year && <div><dt>Үйлдвэрлэсэн он</dt><dd>{rfq.vehicle.year}</dd></div>}
        {rfq.vehicle.vin && <div><dt>Арлын дугаар</dt><dd>{rfq.vehicle.vin}</dd></div>}
      </dl>
      <h3>Үйлчлүүлэгчид юу хэрэгтэй вэ?</h3>
      <ul className={styles.requestItems}>{rfq.items.map((item, index) => <li key={index}><strong>{localizeKnownText(item.description, item.description)}</strong><span>{item.quantity} ширхэг{item.preference ? ` · ${statusLabel(item.preference)}` : ""}</span>{item.partNumber && <small>Сэлбэгийн дугаар: {item.partNumber}</small>}</li>)}</ul>
      <details className={styles.technicalDetails}><summary>Хүсэлтийн дугаар</summary><p>{rfq.id}</p></details>
    </section>
    {assessment && <section className={styles.evidence} aria-labelledby="assessment-title">
      <div className={styles.sectionHead}><h2 id="assessment-title">Хэрэглэгчийн оруулсан үнэлгээ</h2><span className="tag">Үйлчлүүлэгчийн баримт</span></div>
      <p className="notice">Энэ нь хэрэглэгчийн оруулсан үнэлгээ. Танай засварын үнийн санал биш.</p>
      <h3>Гэмтэл + зураг</h3>
      <div className={styles.evidenceGrid}>{assessment.damageItems.map(item => <article key={item.id} className={styles.damageCard}><h3>{item.component}</h3><p>{item.description ?? "Тайлбар ирээгүй"}</p><p className={styles.assessmentAmount}>Үнэлгээ: <strong>{item.assessmentAmount === null ? "Дүн тодорхойгүй" : money(item.assessmentAmount)}</strong></p>{item.imageRefs.length > 0 && <div className={styles.evidenceImages}>{item.imageRefs.map((image, index) => <a key={index} href={image} target="_blank" rel="noopener noreferrer" aria-label={`${item.component} · ${index + 1}-р зургийг томоор үзэх`}><img src={image} alt={`${item.component} гэмтлийн зураг ${index + 1}`} loading="lazy" width="240" height="180" /></a>)}</div>}</article>)}</div>
      {assessment.totalAssessmentAmount !== null && <p className={styles.assessmentAmount}>Тайлангийн нийт үнэлгээ: <strong>{money(assessment.totalAssessmentAmount)}</strong></p>}
      {assessment.notes && <p className="report">{assessment.notes}</p>}
      {(assessment.sourceDocument || assessment.sourceDocumentRef) && <details className={styles.technicalDetails}><summary>Эх баримтыг харах</summary>{assessment.sourceDocumentRef && <p>Баримтын лавлагаа: {assessment.sourceDocumentRef}</p>}{assessment.sourceDocument && <p className="report">{assessment.sourceDocument}</p>}</details>}
    </section>}
    {offers.length > 0 && <section className={styles.panel} aria-labelledby="published-offers-title"><h2 id="published-offers-title">Илгээсэн саналууд</h2><p>Үйлчлүүлэгч таны саналыг шалгаж, зөвшөөрсний дараа захиалга баталгаажна.</p>{offers.map(quote => <PublishedOffer key={`${quote.id}-${quote.revision}`} quote={quote} />)}</section>}
  </>;
}
const vehicle = { make: "Toyota", model: "Prius", generation: "30", yearFrom: 2009, yearTo: 2015 };
function newRecord(resource: AdminResource, merchantId: string) {
  const base = { contractVersion: "1", id: crypto.randomUUID(), merchantId, createdAt: new Date().toISOString(), mode: "simulated" };
  const price = { amountMinor: 0, currency: "MNT" };
  if (resource === "inventory") return { ...base, name: "", partNumber: "", condition: "aftermarket", compatibility: [vehicle], price, minimumPrice: price, stock: 0, warranty: "", active: true };
  if (resource === "service") return { ...base, name: "", vehicles: [vehicle], price, minimumPrice: price, durationMinutes: 60, warranty: "", active: true, customerSuppliedParts: "inspection_required", customerPartsTerms: "" };
  if (resource === "slot") return { ...base, serviceIds: [], startsAt: "", endsAt: "", capacity: 1, status: "available" };
  return { ...base, id: merchantId, maxDiscountBps: 0, negotiationEnabled: false, humanApprovalRequired: true };
}

function Editor({ resource, entry, services, onSave, busy }: { resource: AdminResource; entry: Versioned | { record: Record<string, unknown>; version: number }; services: DashboardSnapshot["services"]; onSave: (record: unknown, version: number) => Promise<void>; busy: boolean }) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => Object.fromEntries(Object.entries(entry.record).map(([key, value]) =>
    [key, ["name", "location", "warranty", "customerPartsTerms"].includes(key) && typeof value === "string" && value ? localizeKnownText(value, "") :
      key === "capabilities" ? (value as string[]).map(item => localizeKnownText(item, "")) : value])));
  const [error, setError] = useState("");
  function set(key: string, value: unknown) { setDraft(d => ({ ...d, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const checked = adminSchemas[resource].safeParse(draft);
    if (!checked.success) { setError(checked.error.issues.map(i => `${localizedFieldPath(i.path.join("."))}: ${validationMessage(i.message)}`).join("; ")); return; }
    const untranslated = localizedAdminFields(draft, resource);
    if (untranslated.length) { setError(`Монгол кириллээр оруулна уу: ${untranslated.map(field => fieldLabels[field]).join(", ")}.`); return; }
    await onSave(checked.data, entry.version);
  }
  function renderField([key, value]: [string, unknown]) {
        const label = key === "price" ? (resource === "service" ? "Ажлын үнэ" : "Нэгж үнэ") : uiFieldLabels[key] ?? fieldLabels[key] ?? "Талбар";
        if (typeof value === "boolean") return <div key={key}><label className={styles.check}><input type="checkbox" checked={value} onChange={e => set(key, e.target.checked)} />{label}</label>{fieldHelp[key] && <p className={styles.helperText}>{fieldHelp[key]}</p>}</div>;
        if (key === "price" || key === "minimumPrice") {
          const money = value as { amountMinor: number; currency: string };
          return <label key={key}>{label} ({money.currency === "MNT" ? "₮" : money.currency})<input required type="number" min="0" step="0.01" value={Number.isNaN(money.amountMinor) ? "" : money.amountMinor / 100} onChange={e => set(key, { ...money, amountMinor: Math.round(e.target.valueAsNumber * 100) })} /><small className={styles.helperText}>{fieldHelp[key] ?? "Танай тогтоосон үнэ. Хэрэглэгчийн үнэлгээний дүнгээс тусдаа."}</small></label>;
        }
        if (key === "maxDiscountBps") return <label key={key}>{label}<input required type="number" min="0" max="100" step="0.01" value={Number.isNaN(value) ? "" : Number(value) / 100} onChange={e => set(key, Math.round(e.target.valueAsNumber * 100))} /><small className={styles.helperText}>Жишээ: 10 гэвэл хамгийн ихдээ 10% хөнгөлнө. Доод үнээс хэтрэхгүй.</small></label>;
        if (key === "startsAt" || key === "endsAt") return <label key={key}>{label}<input required type="datetime-local" value={localDateInput(String(value))} onChange={e => set(key, e.target.value ? new Date(e.target.value).toISOString() : "")} /><small className={styles.helperText}>{fieldHelp[key]}</small></label>;
        if (key === "capabilities") return <label key={key}>{label}<textarea required value={(value as string[]).join("\n")} onChange={e => set(key, e.target.value.split("\n"))} /></label>;
        if (key === "serviceIds") return <div key={key}><h3>Энэ цагт үзүүлэх үйлчилгээ</h3>{services.filter(s => s.record.active).map(s => <label className={styles.check} key={s.record.id}><input type="checkbox" checked={(value as string[]).includes(s.record.id)} onChange={e => set(key, e.target.checked ? [...value as string[], s.record.id] : (value as string[]).filter(id => id !== s.record.id))} />{localizeKnownText(s.record.name, "Засварын үйлчилгээ")}</label>)}{services.length === 0 && <p>Эхлээд үйлчилгээ нэмнэ үү.</p>}</div>;
        if (key === "compatibility" || key === "vehicles") {
          const rows = value as typeof vehicle[];
          return <div key={key}><h3>Тохирох автомашин</h3>{rows.map((row, i) => <div className={styles.vehicle} key={i}>{Object.entries(row).map(([field, fieldValue]) => <label key={field}>{fieldLabels[field] ?? "Талбар"}<input required type={typeof fieldValue === "number" ? "number" : "text"} value={Number.isNaN(fieldValue) ? "" : fieldValue} onChange={e => set(key, rows.map((r, n) => n === i ? { ...r, [field]: typeof fieldValue === "number" ? e.target.valueAsNumber : e.target.value } : r))} /></label>)}<button type="button" className={styles.secondary} onClick={() => set(key, rows.filter((_, n) => n !== i))}>Автомашин хасах</button></div>)}<button type="button" className={styles.secondary} onClick={() => set(key, [...rows, { ...vehicle }])}>Автомашин нэмэх</button></div>;
        }
        if (enums[key]) return <label key={key}>{label}<select value={String(value)} onChange={e => set(key, e.target.value)}>{enums[key].map(option => <option key={option} value={option}>{statusLabel(option)}</option>)}</select></label>;
        return <label key={key}>{label}<input required type={typeof value === "number" ? "number" : "text"} min={typeof value === "number" ? 0 : undefined} step={typeof value === "number" ? 1 : undefined} value={Number.isNaN(value) ? "" : String(value)} onChange={e => set(key, typeof value === "number" ? e.target.valueAsNumber : e.target.value)} />{fieldHelp[key] && <small className={styles.helperText}>{fieldHelp[key]}</small>}</label>;
  }
  const editable = Object.entries(draft).filter(([key]) => !["contractVersion", "id", "merchantId", "createdAt", "mode", "kind", "businessType"].includes(key));
  const groups = resource === "settings" ? [
    { title: "Автомат үнэ тохиролцоо", keys: ["negotiationEnabled", "automaticNegotiationEnabled", "humanApprovalRequired"] },
    { title: "Тохиролцох хязгаар", keys: ["maxDiscountBps", "maxNegotiationRounds", "negotiationTimeoutSeconds"] },
  ] : [
    { title: resource === "profile" ? "Бизнесийн мэдээлэл" : resource === "slot" ? "Боломжит цаг" : "Үндсэн мэдээлэл", keys: editable.filter(([key]) => !["minimumPrice", "vehicles", "compatibility", "serviceIds"].includes(key)).map(([key]) => key) },
    { title: "Тохирох автомашин, үйлчилгээ", keys: ["vehicles", "compatibility", "serviceIds"] },
    { title: "Үнийн тохиролцооны тохиргоо", keys: ["minimumPrice"] },
  ];
  return <form className={styles.editor} onSubmit={submit}>
    <div className={styles.editorHead}><h2>{entry.version ? labels[resource] : `${labels[resource]} нэмэх`}</h2>{resource === "settings" && <span className={styles.privateBadge}>🔒 Зөвхөн танд харагдана</span>}</div>
    <p>{resource === "settings" ? "Энэ нь танай бизнесийн ерөнхий тохиргоо. Хүсэлт бүрийн доод үнэ, зөвшөөрлийн босгыг санал бэлтгэхдээ тусад нь оруулна." : "Нэр, тайлбар, байршил, нөхцөлийг монгол кириллээр тодорхой бичнэ үү."}</p>
    <fieldset disabled={busy}>
      {groups.map(group => {
        const fields = editable.filter(([key]) => group.keys.includes(key));
        return fields.length > 0 && <div className={styles.formSection} key={group.title}><div className={styles.sectionHead}><h3>{group.title}</h3>{group.keys.includes("minimumPrice") && <span className={styles.privateBadge}>🔒 Зөвхөн танд</span>}</div><div className={styles.formGrid}>{fields.map(renderField)}</div></div>;
      })}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.inlineActions}><button type="submit">{busy ? "Хадгалж байна…" : "Өөрчлөлт хадгалах"}</button><span className={styles.helperText}>Хадгалсны дараа шинэ хүсэлтэд ашиглана.</span></div>
    </fieldset>
    <details className={styles.technicalDetails}><summary>Бүртгэлийн мэдээлэл</summary><p className={styles.recordId}>Дугаар: {String(draft.id)} · хувилбар {entry.version}</p></details>
  </form>;
}
export default function MerchantDashboard() {
  const [selected, setSelected] = useState<string>(DEMO_MERCHANTS[0].id);
  const [accessKey, setAccessKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("activity");
  const [edit, setEdit] = useState<Versioned | { record: Record<string, unknown>; version: number } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [requestId, setRequestId] = useState("");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await api("session");
        if (cancelled) return;
        setAuthenticated(true); setSelected(session.merchantId);
        const data = await api("dashboard");
        const telegram = await api("telegram");
        if (!cancelled) { setSnapshot(data); setTelegramConnected(telegram.connected); }
      } catch (e) { if (!cancelled) setError(e instanceof Error ? merchantErrorMessage(e.message) : "Худалдаачны самбарыг ачаалж чадсангүй."); }
      finally { if (!cancelled) setBusy(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (e) { setError(e instanceof Error ? merchantErrorMessage(e.message) : "Үйлдэл амжилтгүй боллоо."); }
    finally { setBusy(false); }
  }
  async function login(event: FormEvent) { event.preventDefault(); await run(async () => {
    await api("session", "POST", { action: "login", merchantId: selected, accessKey });
    setAccessKey(""); setAuthenticated(true); setSnapshot(await api("dashboard"));
    setTelegramConnected((await api("telegram")).connected);
  }); }
  async function switchMerchant(id: string) {
    setSnapshot(null); setEdit(null); setTab("activity"); setRequestId(""); setTelegramConnected(false);
    await run(async () => {
      await api("session", "POST", { action: "switch", merchantId: id });
      setSelected(id); setSnapshot(await api("dashboard")); setTelegramConnected((await api("telegram")).connected);
    });
  }
  async function connectTelegram() {
    await run(async () => {
      const result = await api("telegram", "POST");
      const deepLink = new URL(result.deepLink);
      if (deepLink.protocol !== "https:" || deepLink.hostname !== "t.me") throw new Error("Телеграмын холбоос буруу байна.");
      window.location.assign(deepLink.toString());
    });
  }
  async function refreshTelegramStatus() {
    await run(async () => {
      setTelegramConnected((await api("telegram")).connected);
      setMessage("Телеграмын холболтын төлөвийг шинэчиллээ.");
    });
  }
  async function disconnectTelegram() {
    await run(async () => {
      await api("telegram", "DELETE");
      setTelegramConnected(false);
      setMessage("Телеграмын холболтыг салгалаа.");
    });
  }
  async function updateCommerceProgress(kind: "order" | "booking", entityId: string, status: "preparing" | "ready" | "completed" | "in_service") {
    await run(async () => {
      await api("commerce", "PATCH", { kind, entityId, status });
      setSnapshot(await api("dashboard"));
      setMessage("Захиалгын гүйцэтгэлийн төлөвийг шинэчиллээ.");
    });
  }
  async function refreshDashboard() {
    await run(async () => {
      if (!authenticated) {
        const session = await api("session");
        setAuthenticated(true); setSelected(session.merchantId);
      }
      setEdit(null); setSnapshot(await api("dashboard"));
      setTelegramConnected((await api("telegram")).connected);
    });
  }
  const adminTab = tab === "activity" || tab === "orders" ? null : tab;
  const entries: Versioned[] = !snapshot || !adminTab ? [] : adminTab === "profile" ? [snapshot.profile] : adminTab === "inventory" ? snapshot.inventory : adminTab === "service" ? snapshot.services : adminTab === "slot" ? snapshot.slots : (snapshot.settings ? [snapshot.settings] : []);
  const tabs: Tab[] = ["activity", "orders", ...(snapshot?.profile.record.kind === "repair" ? ["service", "slot"] as Tab[] : ["inventory"] as Tab[]), "settings", "profile"];
  const current = edit ?? entries[0] ?? null;
  const activeRequest = snapshot?.rfqs.find(rfq => rfq.id === requestId) ?? snapshot?.rfqs.find(rfq => rfq.status === "received" || rfq.status === "processing") ?? snapshot?.rfqs[0];
  const newRequests = snapshot?.rfqs.filter(rfq => rfq.status === "received" || rfq.status === "processing").length ?? 0;
  const isRepairShop = snapshot?.profile.record.kind === "repair";
  return <div className={`shell ${styles.merchantRoot}`} lang="mn">
    <aside>
      <Link className="brand" href="/">Зах<span>Агент</span></Link>
      <p>Худалдаачны ажлын самбар</p>
      {authenticated && <nav className={styles.sidebarNav} aria-label="Худалдаачны удирдлага">{tabs.map(item => <button type="button" disabled={busy} key={item} aria-current={tab === item ? "page" : undefined} className={`${styles.sidebarLink} ${tab === item ? styles.sidebarActive : ""}`} onClick={() => { setTab(item); setEdit(null); setMessage(""); }}>{labels[item]}{item === "activity" && newRequests > 0 ? ` · ${newRequests}` : ""}</button>)}</nav>}
      <div className="aside-note">Хүсэлтээ шалгаж, өөрийн үнээр санал өгнө үү. Үйлчлүүлэгч зөвшөөрсний дараа захиалга баталгаажна.</div>
      <Link className={styles.sidebarLink} href="/">← Худалдан авагчийн хэсэг</Link>
    </aside>
    <main className={styles.dashboard}>
      <header className={styles.header}><div><small>ХУДАЛДААЧНЫ ХЭСЭГ</small><h1>{authenticated ? labels[tab] : "Ажлын самбартаа нэвтрэх"}</h1><p>Хэрэглэгчийн хүсэлтээс баталгаажсан захиалга хүртэл.</p></div><span className="badge">Туршилтын орчин</span></header>
      <div className={`notice ${styles.banner}`}>Туршилтын өгөгдөл · Бодит төлбөр хийхгүй. Үнийн санал илгээх нь нөөц, цаг захиалахгүй.</div>
      {error && <div role="alert" className="error"><p className={styles.error}>{error}</p><button className="secondary" type="button" disabled={busy} onClick={() => void refreshDashboard()}>Дахин ачаалах</button></div>}
      {message && <p role="status" className="success">{message}</p>}
      {busy && !snapshot && <section className={styles.loadingState} role="status"><h2>Хүсэлтүүдийг ачаалж байна…</h2><p>Танай бизнесийн мэдээллийг шалгаж байна.</p></section>}
      {!authenticated && !busy ? <form className={styles.login} onSubmit={login}><span className="tag">Тавтай морил</span><h2>Танай бизнес</h2><p>Бизнесээ сонгож, танд өгсөн туршилтын хандалтын түлхүүрээр нэвтэрнэ үү.</p><label>Бизнес сонгох<select disabled={busy} value={selected} onChange={e => setSelected(e.target.value)}>{DEMO_MERCHANTS.map(merchant => <option value={merchant.id} key={merchant.id}>{businessName(merchant.name)}</option>)}</select></label><label>Хандалтын түлхүүр<input disabled={busy} required type="password" autoComplete="off" value={accessKey} onChange={e => setAccessKey(e.target.value)} /></label><button disabled={busy}>{busy ? "Ачаалж байна…" : "Самбар нээх"}</button></form> : authenticated && <>
        {snapshot && <section className={styles.businessSummary} aria-labelledby="business-title"><div className={styles.businessIdentity}><span className="tag">{snapshot.profile.record.kind === "repair" ? "Засварын газар" : "Сэлбэгийн дэлгүүр"}</span><h2 id="business-title">{businessName(snapshot.profile.record.name)}</h2><p>{localizeKnownText(snapshot.profile.record.location, snapshot.profile.record.location)} · {snapshot.profile.record.active ? "Хүсэлт хүлээн авч байна" : "Хүсэлт хүлээн авахгүй"}</p></div>{!isRepairShop && <div className={styles.summaryActions}><span className={styles.connectionBadge} data-connected={telegramConnected} role="status"><span className={styles.statusDot} aria-hidden="true" />Telegram · {telegramConnected ? "Холбогдсон" : "Холбогдоогүй"}</span>{!telegramConnected && <button disabled={busy} type="button" onClick={() => void connectTelegram()}>Telegram холбох</button>}<details className={styles.technicalDetails}><summary>Холболтын тохиргоо</summary><p>Бот дээрх Start товчийг дарж холболтоо батална уу. Холбох холбоос нэг удаа ашиглагдана.</p><div className={styles.inlineActions}><button disabled={busy} type="button" className="secondary" onClick={() => void refreshTelegramStatus()}>Төлөв шинэчлэх</button>{telegramConnected && <button disabled={busy} type="button" className="secondary" onClick={() => void disconnectTelegram()}>Холболт салгах</button>}</div></details></div>}</section>}
        <div className={styles.toolbar}><label>Бизнес сонгох<select disabled={busy} value={selected} onChange={e => void switchMerchant(e.target.value)}>{DEMO_MERCHANTS.map(merchant => <option value={merchant.id} key={merchant.id}>{businessName(merchant.name)}</option>)}</select></label><button disabled={busy} type="button" className="secondary" onClick={() => void refreshDashboard()}>Мэдээлэл шинэчлэх</button><button disabled={busy} type="button" className="secondary" onClick={() => void run(async () => { await api("session", "POST", { action: "logout" }); setSnapshot(null); setEdit(null); setRequestId(""); setAuthenticated(false); })}>Гарах</button></div>
        {snapshot && <>
          <div className={styles.metrics}><div><small>Шинэ хүсэлт</small><strong>{newRequests}</strong></div><div><small>Илгээсэн санал</small><strong>{snapshot.quotes.filter(quote => quote.status === "offered").length}</strong></div><div><small>{snapshot.profile.record.kind === "repair" ? "Үйлчилгээ" : "Нөөцийн бүртгэл"}</small><strong>{snapshot.profile.record.kind === "repair" ? snapshot.services.length : snapshot.inventory.length}</strong></div><div><small>{snapshot.profile.record.kind === "repair" ? "Боломжтой цаг" : "Сэлбэгийн захиалга"}</small><strong>{snapshot.profile.record.kind === "repair" ? snapshot.slots.filter(slot => slot.record.status === "available").length : snapshot.commerceOrders.length}</strong></div></div>
          {busy && <p role="status" className={styles.helperText}>Мэдээллийг шинэчилж байна…</p>}
          {tab === "activity" ? <>
            <div className={styles.requestLayout}><section className={styles.requestList} aria-labelledby="requests-title"><div className={styles.sectionHead}><h2 id="requests-title">Шинэ хүсэлтүүд</h2><span className="tag">{snapshot.rfqs.length}</span></div><p className={styles.muted}>Хүсэлт сонгож, хэрэгцээ болон баримтыг шалгана уу.</p>{snapshot.rfqs.length === 0 ? <div className={styles.emptyState}><h3>Одоогоор шинэ хүсэлт алга.</h3><p>Шинэ хүсэлт ирэхэд энд харагдана.</p><button className="secondary" disabled={busy} onClick={() => void refreshDashboard()}>Дахин шалгах</button></div> : snapshot.rfqs.map(rfq => <button disabled={busy} key={rfq.id} type="button" className={`${styles.requestButton} ${activeRequest?.id === rfq.id ? styles.activeRequest : ""}`} aria-pressed={activeRequest?.id === rfq.id} onClick={() => setRequestId(rfq.id)}><span className={styles.statusBadge} data-status={rfq.status}>{requestStatus(rfq.status)}</span><strong>{vehicleName(rfq)}</strong><span>{localizeKnownText(rfq.items[0]?.description ?? "", rfq.items[0]?.description ?? "")}{rfq.items.length > 1 ? ` + ${rfq.items.length - 1}` : ""}</span><small>{dateTime(rfq.createdAt)}</small></button>)}</section>
              <div>{activeRequest ? <><RequestDetails rfq={activeRequest} offers={snapshot.quotes.filter(quote => quote.rfqId === activeRequest.id)} />{["received", "processing", "quoted"].includes(activeRequest.status) && <MerchantOfferComposer key={`${snapshot.merchantId}-${activeRequest.id}`} rfq={activeRequest} snapshot={snapshot} busy={busy} telegramConnected={telegramConnected} onConnectTelegram={() => void connectTelegram()} />}</> : <section className={styles.emptyState}><h2>Танай дараагийн санал эндээс эхэлнэ</h2><p>Хүсэлт ирэхэд машин, шаардлагатай сэлбэг эсвэл засвар, хавсаргасан баримтыг эндээс хараарай.</p><ol className={styles.offerSteps}><li>Хүсэлтээ шалгах</li><li>Өөрийн үнийг оруулах</li><li>{isRepairShop ? "Саналаа урьдчилан харах" : "Telegram-д шалгаж, баталгаажуулах"}</li></ol></section>}</div>
            </div>
            {snapshot.quotes.length > 0 && <section className={styles.panel}><details className={styles.technicalDetails}><summary>Бүх илгээсэн санал ({snapshot.quotes.length})</summary>{snapshot.quotes.map(quote => <PublishedOffer key={`${quote.id}-${quote.revision}`} quote={quote} />)}</details></section>}
          </> : tab === "orders" ? <CommerceActivity snapshot={snapshot} busy={busy} onProgress={updateCommerceProgress} /> : adminTab && <div className={styles.workarea}>
            <section className={styles.panel}><div className={styles.sectionHead}><h2>{labels[adminTab]}</h2>{adminTab === "settings" && <span className={styles.privateBadge}>🔒 Хувийн</span>}</div><p>{adminTab === "profile" ? "Энэ танилцуулга хэрэглэгчид харагдана." : adminTab === "settings" ? "Танай бизнесийн ерөнхий хязгаар. Хэрэглэгчид харагдахгүй." : "Танай үнэ, нөөц, боломжийг шинэ хүсэлтэд ашиглана."}</p>{entries.length === 0 && <p className={styles.emptyState}>Одоогоор бүртгэл алга. Эхний бүртгэлээ нэмнэ үү.</p>}{entries.map(entry => <button disabled={busy} className={`${styles.recordButton} ${current?.record.id === entry.record.id ? styles.selectedRecord : ""}`} aria-pressed={current?.record.id === entry.record.id} key={entry.record.id} type="button" onClick={() => setEdit(entry)}><strong>{"name" in entry.record ? localizeKnownText(entry.record.name, entry.record.name) : "startsAt" in entry.record ? dateTime(entry.record.startsAt) : "Танай үнийн тохиролцоо"}</strong><small>{"stock" in entry.record ? `${entry.record.stock} ширхэг` : "active" in entry.record ? (entry.record.active ? "Идэвхтэй" : "Идэвхгүй") : "status" in entry.record ? statusLabel(entry.record.status) : "Зөвхөн танд харагдана"}</small>{"price" in entry.record && <span>{money(entry.record.price)}</span>}</button>)}{adminTab !== "profile" && (adminTab !== "settings" || !snapshot.settings) && <button disabled={busy} type="button" onClick={() => setEdit({ record: newRecord(adminTab, snapshot.merchantId), version: 0 })}>+ {labels[adminTab]} нэмэх</button>}</section>
            {current && <Editor key={`${snapshot.merchantId}-${adminTab}-${current.record.id}-${current.version}`} resource={adminTab} entry={current} services={snapshot.services} busy={busy} onSave={async (record, version) => { await run(async () => { await api("dashboard", "PUT", { resource: adminTab, record, expectedVersion: version }); setSnapshot(await api("dashboard")); setEdit(null); setMessage("Өөрчлөлтийг хадгаллаа."); }); }} />}
          </div>}
        </>}
      </>}
    </main>
  </div>;
}

function CommerceActivity({ snapshot, busy, onProgress }: {
  snapshot: DashboardSnapshot; busy: boolean;
  onProgress: (kind: "order" | "booking", id: string, status: "preparing" | "ready" | "completed" | "in_service") => Promise<void>;
}) {
  const resourceName = (id: string) => {
    const record = [...snapshot.inventory, ...snapshot.services].find(entry => entry.record.id === id)?.record;
    return record ? localizeKnownText(record.name, record.name) : id;
  };
  return <div className={styles.tradeGrid}>
    {(snapshot.profile.record.kind === "parts" || snapshot.commerceOrders.length > 0) && <section className={styles.panel}><h2>Сэлбэгийн захиалга</h2>{snapshot.commerceOrders.length === 0 ? <p className={styles.emptyState}>Одоогоор захиалга алга.</p> : snapshot.commerceOrders.map(order => <article key={order.id}><div className={styles.sectionHead}><h3>Сэлбэгийн захиалга</h3><span className="tag">{statusLabel(order.status)}</span></div><p>Төлбөр: {statusLabel(order.payment)}</p><p>{order.lines.map(line => `${resourceName(line.resourceId)} · ${line.quantity} ширхэг`).join("; ")}</p><strong>{money(order.total)}</strong><details className={styles.technicalDetails}><summary>Захиалгын дугаар</summary><p>{order.id}</p></details><div className={styles.inlineActions}>{order.status === "reserved" && <button disabled={busy} onClick={() => void onProgress("order", order.id, "preparing")}>Бэлтгэж эхлэх</button>}{order.status === "preparing" && <button disabled={busy} onClick={() => void onProgress("order", order.id, "ready")}>Бэлэн болгох</button>}{order.status === "ready" && <button disabled={busy} onClick={() => void onProgress("order", order.id, "completed")}>Гүйцэтгэсэн</button>}</div></article>)}</section>}
    {(snapshot.profile.record.kind === "repair" || snapshot.commerceBookings.length > 0) && <section className={styles.panel}><h2>Засварын цаг захиалга</h2>{snapshot.commerceBookings.length === 0 ? <p className={styles.emptyState}>Одоогоор захиалга алга.</p> : snapshot.commerceBookings.map(booking => <article key={booking.id}><div className={styles.sectionHead}><h3>{booking.serviceIds.map(resourceName).join(", ")}</h3><span className="tag">{statusLabel(booking.status)}</span></div><p>{dateTime(booking.startsAt)} – {dateTime(booking.endsAt)}</p><p>Төлбөр: {statusLabel(booking.payment)} · Сэлбэгээ өөрөө авчрах: {booking.customerSuppliedParts ? "Тийм" : "Үгүй"}</p><details className={styles.technicalDetails}><summary>Захиалгын дугаар</summary><p>{booking.id}</p></details><div className={styles.inlineActions}>{booking.status === "booked" && <button disabled={busy} onClick={() => void onProgress("booking", booking.id, "in_service")}>Засвар эхлүүлэх</button>}{booking.status === "in_service" && <button disabled={busy} onClick={() => void onProgress("booking", booking.id, "completed")}>Засвар дуусгах</button>}</div></article>)}</section>}
    <section className={styles.panel}><h2>Захиалгын төлөв</h2>{snapshot.commerceTransactions.length === 0 ? <p className={styles.emptyState}>Одоогоор гүйлгээ алга.</p> : snapshot.commerceTransactions.map(transaction => <article key={transaction.id}><h3>{transaction.kind === "parts_and_repair" ? "Сэлбэг, засварын багц" : statusLabel(transaction.kind)}</h3><p><span className="tag">{statusLabel(transaction.status)}</span> · {statusLabel(transaction.progress)}</p><p>{transaction.paymentId ? "Туршилтын төлбөр бүртгэгдсэн" : "Төлбөр бүртгэгдээгүй"}</p><details className={styles.technicalDetails}><summary>Гүйлгээний дугаар</summary><p>{transaction.id}</p></details></article>)}</section>
    <section className={styles.panel}><details className={styles.technicalDetails}><summary>Гүйлгээний түүх ({snapshot.transactions.length})</summary>{snapshot.transactions.length === 0 ? <p>Одоогоор гүйлгээ алга.</p> : snapshot.transactions.map(transaction => <article key={transaction.id}><p>{statusLabel(transaction.status)} · {dateTime(transaction.createdAt)}</p><strong>{money(transaction.total)}</strong><p className={styles.recordId}>{transaction.id}</p></article>)}</details></section>
  </div>;
}
