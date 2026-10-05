"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { z } from "zod";
import { repairReportSchema } from "@/lib/repair-report";
import {
  searchViewSchema,
  type SearchView,
  type SearchGoal,
} from "@/lib/buyer-search-types";
import styles from "./buyer-market.module.css";

type IconName = "spark" | "upload" | "shop" | "check" | "arrow";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    spark: "m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z",
    upload: "M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5",
    shop: "M3 10h18l-2-6H5l-2 6Zm2 0v10h14V10M9 20v-6h6v6",
    check: "m5 12 4 4L19 6",
    arrow: "M5 12h14m-5-5 5 5-5 5",
  };

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

const savedKey = "zahagent-market-search";

const parseSchema = z.object({
  result: repairReportSchema,
  requestId: z.string().uuid(),
});

const responseSchema = z.object({
  search: searchViewSchema,
  message: z.string().optional(),
});

const money = (amount: number) => `${amount.toLocaleString("mn-MN")}₮`;

const condition: Record<string, string> = {
  oem: "Оригинал",
  aftermarket: "Үйлдвэрийн бус шинэ",
  used: "Хуучин",
  unknown: "Төлөв дурдаагүй",
};

const list = (value: string) =>
  value
    .split(/[,;\n]+/)
    .map((row) => row.trim())
    .filter(Boolean);

async function json(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("Хүсэлт хугацаандаа дууссангүй. Дахин оролдоорой.");
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(body);

    throw new Error(
      parsed.success
        ? parsed.data.error
        : "Серверийн хариуг боловсруулах боломжгүй байна.",
    );
  }

  return body;
}

async function action(payload: unknown) {
  return responseSchema.parse(
    await json("/api/buyer/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export default function BuyerMarket() {
  const [report, setReport] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [parts, setParts] = useState("");
  const [tasks, setTasks] = useState("");
  const [withRepair, setWithRepair] = useState(false);
  const [budget, setBudget] = useState("1500000");
  const [days, setDays] = useState("10");
  const [preference, setPreference] = useState<SearchGoal["preference"]>("Any");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [search, setSearch] = useState<SearchView | null>(null);
  const [chosen, setChosen] = useState("");
  const [target, setTarget] = useState("");
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pollError, setPollError] = useState("");

  const lock = useRef(false);
  const previewRef = useRef("");

  const searchId = search?.id;
  const searchStatus = search?.status;
  const bundle = search?.bundles.find((row) => row.key === chosen);

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    const id = localStorage.getItem(savedKey);

    if (id) {
      void json(`/api/buyer/search?id=${encodeURIComponent(id)}`)
        .then((raw) => {
          const result = responseSchema.parse(raw);

          if (active) {
            setSearch(result.search);
            setNotice("Хадгалсан хайлтыг сэргээлээ.");
          }
        })
        .catch(() => {
          localStorage.removeItem(savedKey);
        });
    }

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!searchId || searchStatus !== "searching") return;

    let active = true;
    let polling = false;
    const id = searchId;

    const timer = setInterval(async () => {
      if (polling || lock.current) return;
      polling = true;

      try {
        const result = responseSchema.parse(
          await json(`/api/buyer/search?id=${id}`),
        );

        if (active) {
          setSearch(result.search);
          setPollError("");
        }
      } catch {
        if (active) {
          setPollError(
            "Саналуудыг шинэчилж чадсангүй. Хариу шалгах товчоор дахин оролдоорой.",
          );
        }
      } finally {
        polling = false;
      }
    }, 5000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [searchId, searchStatus]);

  async function run(work: () => Promise<void>) {
    if (lock.current) return;

    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Алдаа гарлаа.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function reset() {
    localStorage.removeItem(savedKey);
    setSearch(null);
    setChosen("");
    setApproved(false);
    setTarget("");
    setPollError("");
    setError("");
    setNotice("");
  }
  async function parse() {
    if (!image && report.trim().length < 10) {
      throw new Error("Оношлогооны зураг эсвэл тайлангийн текст оруулна уу.");
    }

    const form = new FormData();
    form.set("report", report);
    if (image) form.set("image", image);

    const { result } = parseSchema.parse(
      await json("/api/buyer/parse-report", {
        method: "POST",
        body: form,
      }),
    );

    setVehicle(result.vehicle);
    setParts(result.parts);
    setTasks(result.tasks);
    setWarnings(result.warnings);
    setNotice(
      "Машин, сэлбэг, ажлыг шалгаж засаад лангуунаас санал асуугаарай.",
    );
  }

  async function start() {
    const { search: value } = await action({
      action: "create",
      goal: {
        vehicle,
        items: [
          ...list(parts).map((description) => ({
            description,
            quantity: 1,
            kind: "parts",
          })),
          ...(withRepair
            ? list(tasks).map((description) => ({
                description,
                quantity: 1,
                kind: "repair",
              }))
            : []),
        ],
        budget: Number(budget),
        days: Number(days),
        preference,
      },
    });

    setSearch(value);
    setChosen("");
    setApproved(false);
    localStorage.setItem(savedKey, value.id);
    setNotice(
      `${value.recipients.length} холбогдсон лангуунд хүсэлт бэлдлээ. Эзэд хариулж батлахад энд саналууд гарна.`,
    );
  }

  async function refresh() {
    const result = responseSchema.parse(
      await json(`/api/buyer/search?id=${search!.id}`),
    );

    setSearch(result.search);
    setNotice("Хариунуудыг шинэчиллээ.");
  }

  async function negotiate(auto: boolean) {
    if (!bundle?.complete) {
      throw new Error("Бүх хэрэгтэй сэлбэгийг хамарсан багц сонгоно уу.");
    }

    const { search: value, message } = await action({
      action: "negotiate",
      id: search!.id,
      key: bundle.key,
      ...(auto ? {} : { target: Number(target) }),
    });

    setSearch(value);
    setApproved(false);
    setNotice(message ?? "Лангууны эзний хариу хүлээж байна.");
  }

  async function select() {
    if (!bundle || !approved) {
      throw new Error("Эцсийн үнийг зөвшөөрнө үү.");
    }

    const result = await action({
      action: "select",
      id: search!.id,
      key: bundle.key,
      approved: true,
      approvedTotal: bundle.total,
    });

    setSearch(result.search);
    setNotice(
      "Сонгосон багц, үнийг хадгаллаа. Эзэдтэй тохирсон санал сонгогдсон; төлбөр хийгээгүй.",
    );
  }

  function changeImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (file && file.size > 8 * 1024 * 1024) {
      setError("Зураг 8 MB-аас бага байна.");
      event.target.value = "";
      return;
    }

    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
    }

    previewRef.current = file ? URL.createObjectURL(file) : "";
    setImage(file);
    setPreview(previewRef.current);
    setError("");
    setVehicle("");
    setParts("");
    setTasks("");
    setWarnings([]);
  }

  function removeImage() {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
    }

    previewRef.current = "";
    setImage(null);
    setPreview("");
  }

  const stage = !search
    ? 0
    : search.status === "selected"
      ? 3
      : search.offers.length
        ? 2
        : 1;

  const steps = ["Оношлогоо оруулах", "Лангуунаас санал авах", "Багцаа сонгох"];

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark}>Z</span>
          <span>
            ZahAgent
            <small>Таны сэлбэгийн туслах</small>
          </span>
        </Link>

        <Link href="/merchant" className={styles.merchantLink}>
          <Icon name="shop" />
          Лангууны самбар
          <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>
            <span className={styles.dot} />
            ТАНЫ BUYER AGENT
          </span>

          <h1>
            Оношлогоогоо оруул.
            <br />
            <span>Сэлбэгээ бид хайя.</span>
          </h1>

          <p>
            Холбогдсон лангууны эздээс үнэ, бэлэн эсэх, зураг асууж, танд
            тохирох багцуудыг харьцуулна.
          </p>

          <div className={styles.heroTags}>
            <span>
              <Icon name="spark" />
              AI тайлан уншина
            </span>
            <span>
              <Icon name="check" />
              Эзэн үнэ батална
            </span>
          </div>
        </div>

        <div className={styles.heroFlow}>
          <p className={styles.flowTitle}>ТАНЫ НЭГ ХҮСЭЛТЭЭС</p>

          {[
            {
              icon: "upload" as const,
              title: "Оношлогоо",
              detail: "Зураг эсвэл текстээ оруул",
            },
            {
              icon: "shop" as const,
              title: "Лангууны саналууд",
              detail: "Үнэ, төлөв, зургийг харьцуул",
            },
            {
              icon: "check" as const,
              title: "Таны сонголт",
              detail: "Үнэ тохиролцоод багцаа сонго",
            },
          ].map((step, index) => (
            <div className={styles.flowRow} key={step.title}>
              <span className={styles.flowIcon}>
                <Icon name={step.icon} />
              </span>
              <div>
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </div>
              <span className={styles.flowNumber}>0{index + 1}</span>
            </div>
          ))}
        </div>
      </section>

      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li
            key={step}
            className={`${styles.step} ${
              stage === index ? styles.stepActive : ""
            } ${stage > index ? styles.stepDone : ""}`}
            aria-current={stage === index ? "step" : undefined}
          >
            <span>{stage > index ? <Icon name="check" /> : index + 1}</span>
            <strong>{step}</strong>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className={styles.notice}>
          {notice}
        </p>
      )}

      {!search ? (
        <div className={styles.entryGrid}>
          <section className={styles.card}>
            <h2>1. Оношлогооны зураг эсвэл текст</h2>

            <label className={styles.upload}>
              <span className={styles.uploadIcon}>
                <Icon name="upload" />
              </span>
              <strong>
                {image ? image.name : "Оношлогооны зургаа сонгох"}
              </strong>
              <span>Зураг сонгохын тулд энд дарна уу</span>
              <small>JPG, PNG, WebP · 8 MB хүртэл</small>
              <input
                className={styles.fileInput}
                aria-label="Оношлогооны зураг сонгох"
                disabled={busy}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={changeImage}
              />
            </label>

            {image && (
              <div className={styles.previewBox}>
                {preview && (
                  <Image
                    src={preview}
                    unoptimized
                    width={480}
                    height={300}
                    alt="Оношлогооны сонгосон зураг"
                    className={styles.photo}
                  />
                )}
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={removeImage}
                >
                  Зураг хасах
                </button>
              </div>
            )}

            <label>
              Тайлангийн текст / нэмэлт тайлбар
              <textarea
                disabled={busy}
                rows={5}
                maxLength={12000}
                value={report}
                onChange={(e) => setReport(e.target.value)}
                placeholder="Зураг оруулсан бол текст заавал бичихгүй."
              />
            </label>

            <button
              disabled={busy || (!image && report.trim().length < 10)}
              onClick={() => void run(parse)}
            >
              {busy ? "Боловсруулж байна…" : "AI-аар оношлогоо уншуулах"}
            </button>

            <p>
              Гараар бөглөх бол машин, сэлбэгийн талбаруудаа шууд ашиглаж болно.
            </p>
          </section>

          <section className={styles.card}>
            <h2>2. Хэрэгтэй зүйлсээ шалга</h2>

            {warnings.length > 0 && (
              <div className={styles.notice}>
                <strong>AI тодруулахыг хүссэн мэдээлэл:</strong>
                <ul>
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <label>
              Машины марк, загвар, үе / он
              <input
                disabled={busy}
                value={vehicle}
                maxLength={200}
                onChange={(e) => setVehicle(e.target.value)}
                placeholder="Жишээ: Honda Fit 2014"
              />
            </label>

            <label>
              Хэрэгтэй сэлбэгүүд — мөр бүрд нэг
              <textarea
                disabled={busy}
                value={parts}
                rows={4}
                onChange={(e) => setParts(e.target.value)}
                placeholder={"Баруун урд гэрэл\nУрд бампер"}
              />
            </label>

            <label>
              Засварын ажил
              <textarea
                disabled={busy}
                value={tasks}
                rows={3}
                onChange={(e) => setTasks(e.target.value)}
              />
            </label>

            <label className={styles.check}>
              <input
                disabled={busy}
                type="checkbox"
                checked={withRepair}
                onChange={(e) => setWithRepair(e.target.checked)}
              />
              Засварын газруудаас ажлын хөлс бас асуух
            </label>

            <div className={styles.grid}>
              <label>
                Төсөв (₮)
                <input
                  disabled={busy}
                  type="number"
                  min={1}
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>

              <label>
                Хэд хоногийн дотор?
                <input
                  disabled={busy}
                  type="number"
                  min={1}
                  max={30}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </label>

              <label>
                Сэлбэгийн сонголт
                <select
                  disabled={busy}
                  value={preference}
                  onChange={(e) =>
                    setPreference(e.target.value as SearchGoal["preference"])
                  }
                >
                  <option value="Any">Аль ч төрөл</option>
                  <option value="OEM">Оригинал</option>
                  <option value="Aftermarket">Үйлдвэрийн бус шинэ</option>
                  <option value="Used">Хуучин</option>
                </select>
              </label>
            </div>

            <button
              disabled={
                busy ||
                !vehicle.trim() ||
                (!parts.trim() && !(withRepair && tasks.trim()))
              }
              onClick={() => void run(start)}
            >
              Лангууны эздээс санал асуух
            </button>
          </section>
        </div>
      ) : (
        <>
          <section className={styles.card}>
            <h2>
              {search.status === "selected"
                ? "Сонгосон багц"
                : "3. Лангууны хариунууд"}
            </h2>

            <strong>{search.goal.vehicle}</strong>
            <p>
              {search.goal.items.map((item) => item.description).join(", ")}
            </p>
            <p>
              Төсөв: {money(search.goal.budget)} · Хариу авах хүртэл:{" "}
              {new Date(search.expiresAt).toLocaleTimeString("mn-MN")}
            </p>

            <ul>
              {search.recipients.map((recipient, index) => (
                <li key={index}>
                  {recipient.name} —{" "}
                  {recipient.status === "sent"
                    ? "Хүсэлт хүрсэн"
                    : "Илгээхээр хүлээж байна"}
                </li>
              ))}
            </ul>

            <div className={styles.actions}>
              <button disabled={busy} onClick={() => void run(refresh)}>
                Хариу шалгах
              </button>
              <button
                className={styles.secondary}
                disabled={busy}
                onClick={reset}
              >
                Шинэ хүсэлт
              </button>
            </div>

            {pollError && (
              <p role="status" className={styles.notice}>
                {pollError}
              </p>
            )}

            {search.status === "closed" && (
              <p>Хариу авах хугацаа дууссан. Шинэ хүсэлт үүсгээрэй.</p>
            )}

            {search.negotiationPending && (
              <p className={styles.notice}>
                Agent үнэ тохиролцож байна. Лангууны эзний хариуг хүлээнэ.
              </p>
            )}
          </section>

          <div className={styles.grid}>
            {search.offers.map((offer) => (
              <article key={offer.id} className={styles.card}>
                <div className={styles.offerHeader}>
                  <span className={styles.avatar}>
                    {offer.merchantName.slice(0, 1)}
                  </span>
                  <div>
                    <h3>{offer.merchantName}</h3>
                    <span className={styles.verified}>
                      <Icon name="check" />
                      Эзэн баталсан санал
                    </span>
                  </div>
                </div>

                {offer.lines.map((line) => (
                  <p key={line.itemIndex}>
                    <strong>
                      {line.description} — {money(line.unitPrice)} / ширхэг
                    </strong>
                    <br />
                    {condition[line.condition]} ·{" "}
                    {line.warranty || "Баталгаа дурдаагүй"}
                    <br />
                    {line.notes}
                  </p>
                ))}

                <div className={styles.photos}>
                  {offer.photos.map((photo) => (
                    <Image
                      key={photo}
                      unoptimized
                      src={`/api/buyer/search/photo?search=${search.id}&id=${photo}`}
                      width={260}
                      height={180}
                      alt={`${offer.merchantName}-ийн сэлбэгийн зураг`}
                      className={styles.photo}
                    />
                  ))}
                </div>
              </article>
            ))}
          </div>

          {search.offers.length === 0 && (
            <section className={`${styles.card} ${styles.empty}`}>
              <span className={styles.emptyIcon}>
                <Icon name="shop" />
              </span>
              <h3>Лангууны эздийн хариуг хүлээж байна</h3>
              <p>
                Эзэд үнийн хариугаа батлахад саналууд энд гарна. Хариунуудыг 5
                секунд тутам шинэчилнэ.
              </p>
            </section>
          )}

          {search.bundles.length > 0 && (
            <section className={styles.card}>
              <h2>4. Аль багцыг сонирхож байна?</h2>
              <p>Хүссэн бүх мөрийг хамарсан багцуудыг нийт үнээр эрэмбэлэв.</p>

              {search.bundles.map((row, index) => (
                <label key={row.key} className={styles.bundle}>
                  <input
                    type="radio"
                    name="market-bundle"
                    disabled={
                      busy ||
                      search.status !== "searching" ||
                      search.negotiationPending ||
                      !row.complete
                    }
                    checked={chosen === row.key}
                    onChange={() => {
                      setChosen(row.key);
                      setApproved(false);
                    }}
                  />

                  <div>
                    <strong>
                      {row.complete && index === 0
                        ? "Хамгийн хямд бүрэн багц · "
                        : ""}
                      {money(row.total)}
                    </strong>

                    <p>
                      {row.lines
                        .map(
                          (line) =>
                            `${line.description}: ${line.merchantName} (${money(
                              line.unitPrice * line.quantity,
                            )})`,
                        )
                        .join(" · ")}
                    </p>

                    {!row.complete && (
                      <p>
                        Дутуу:{" "}
                        {row.missing
                          .map(
                            (itemIndex) =>
                              search.goal.items[itemIndex].description,
                          )
                          .join(", ")}
                      </p>
                    )}

                    {row.total > search.goal.budget && (
                      <p>
                        Төсвөөс {money(row.total - search.goal.budget)} илүү
                      </p>
                    )}
                  </div>
                </label>
              ))}

              {chosen && !bundle && (
                <p>Үнэ шинэчлэгдсэн. Шинэ багцаа сонгоорой.</p>
              )}

              {bundle && search.status === "searching" && (
                <div className={styles.card}>
                  <h3>Сонгосон багц: {money(bundle.total)}</h3>
                  <p>
                    Agent өөрөө 5% хөнгөлөлт асууж болно, эсвэл хүссэн нийт үнээ
                    оруулаарай. Эзэн зөвшөөрөх эсэхээ шийднэ.
                  </p>

                  <label>
                    Таны зорилтот нийт үнэ (₮)
                    <input
                      disabled={busy || search.negotiationPending}
                      type="number"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    />
                  </label>

                  <div className={styles.actions}>
                    <button
                      disabled={busy || search.negotiationPending}
                      onClick={() => void run(() => negotiate(true))}
                    >
                      Agent-аар үнэ тохиролцуулах
                    </button>
                    <button
                      className={styles.secondary}
                      disabled={busy || search.negotiationPending || !target}
                      onClick={() => void run(() => negotiate(false))}
                    >
                      Миний үнээр асуух
                    </button>
                  </div>

                  <label className={styles.check}>
                    <input
                      disabled={busy || search.negotiationPending}
                      type="checkbox"
                      checked={approved}
                      onChange={(e) => setApproved(e.target.checked)}
                    />
                    Энэ багцыг {money(bundle.total)} үнээр сонгож байна.
                  </label>

                  <button
                    disabled={busy || !approved || search.negotiationPending}
                    onClick={() => void run(select)}
                  >
                    Багц сонголтоо батлах
                  </button>
                </div>
              )}

              {search.status === "selected" && search.selected && (
                <p className={styles.notice}>
                  Багц сонголт хадгалагдсан: {money(search.selected.total)}. Энэ
                  нь үнийн саналын сонголт; бараа резервлээгүй, төлбөр
                  хийгээгүй.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
