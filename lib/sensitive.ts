/**
 * Sensitive-photo check for the phone-backup galleries, done entirely in the
 * viewer's browser (nothing is sent to any outside service). Each photo is
 * scored by a small image model (NSFWJS, MobileNetV2, bundled with the site);
 * anything that looks explicit or racy is kept blurred behind a
 * "Sensitive content" cover until someone taps it — like Twitter/X.
 *
 * Verdicts are remembered per photo in this browser so a photo is only scored
 * once. Photos that couldn't be scored (the backup server didn't allow the
 * browser to read them yet) stay covered too, as the safe default.
 */

export type Verdict = "pending" | "safe" | "sensitive" | "unknown";

const STORE_KEY = "rr-sensitive-v2";
const MAX_REMEMBERED = 6000;

// ---- remembered verdicts (localStorage, best effort) ----

let remembered: Record<string, 0 | 1> | null = null;

function loadRemembered(): Record<string, 0 | 1> {
  if (remembered) return remembered;
  remembered = {};
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) remembered = JSON.parse(raw) || {};
  } catch { /* private window or blocked storage — just don't remember */ }
  return remembered!;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function remember(key: string, sensitive: boolean) {
  const r = loadRemembered();
  r[key] = sensitive ? 1 : 0;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const keys = Object.keys(r);
      if (keys.length > MAX_REMEMBERED) for (const k of keys.slice(0, keys.length - MAX_REMEMBERED)) delete r[k];
      localStorage.setItem(STORE_KEY, JSON.stringify(r));
    } catch { /* ignore */ }
  }, 800);
}

/** A remembered verdict for this photo, or "pending" if it hasn't been scored here yet. */
export function knownVerdict(key: string): Verdict {
  if (typeof window === "undefined") return "pending";
  const v = loadRemembered()[key];
  return v === 1 ? "sensitive" : v === 0 ? "safe" : "pending";
}

// ---- photos the viewer chose to show (this page visit only) ----

const revealed = new Set<string>();
const listeners = new Set<() => void>();

export function isRevealed(key: string) { return revealed.has(key); }
export function reveal(key: string) {
  revealed.add(key);
  listeners.forEach((l) => l());
}
export function onRevealChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ---- the model ----

let modelPromise: Promise<any> | null = null;

function getModel(): Promise<any> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import("@tensorflow/tfjs");
      try { await tf.setBackend("webgl"); } catch { /* falls back to cpu */ }
      await tf.ready();
      const { load } = await import("nsfwjs/core");
      const { MobileNetV2Model } = await import("nsfwjs/models/mobilenet_v2");
      return load("MobileNetV2", { modelDefinitions: [MobileNetV2Model] });
    })().catch((e) => {
      modelPromise = null; // let a later photo try again
      throw e;
    });
  }
  return modelPromise;
}

// One photo at a time so a big gallery doesn't freeze the page.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Scores one loaded <img>. It must have been loaded with crossOrigin so its
 * pixels are readable; returns "unknown" if they aren't.
 */
export function scan(key: string, img: HTMLImageElement): Promise<Verdict> {
  const job = queue.then(async (): Promise<Verdict> => {
    const known = knownVerdict(key);
    if (known !== "pending") return known;
    try {
      const model = await getModel();
      // Shrink first: classifying a 12-megapixel photo directly is slow.
      const c = document.createElement("canvas");
      c.width = 224; c.height = 224;
      const ctx = c.getContext("2d");
      if (!ctx) return "unknown";
      // Centre square, not squashed: a stretched photo confuses the model.
      const sw = img.naturalWidth || img.width, sh = img.naturalHeight || img.height, sq = Math.min(sw, sh);
      ctx.drawImage(img, (sw - sq) / 2, (sh - sq) / 2, sq, sq, 0, 0, 224, 224);
      ctx.getImageData(0, 0, 1, 1); // throws here if the pixels aren't readable
      const preds: { className: string; probability: number }[] = await model.classify(c, 5);
      const p = (name: string) => preds.find((x) => x.className === name)?.probability || 0;
      // Only confident "explicit" verdicts; "suggestive" alone flags ordinary photos of people.
      const sensitive = Math.max(p("Porn"), p("Hentai")) >= 0.8 || p("Porn") + p("Hentai") >= 0.9;
      remember(key, sensitive);
      return sensitive ? "sensitive" : "safe";
    } catch {
      return "unknown";
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
