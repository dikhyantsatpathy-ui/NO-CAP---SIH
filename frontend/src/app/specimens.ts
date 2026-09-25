// ============================================================================
// Synthetic Document Specimen Generator for SIH26188 Screening Desk
// Generates high-fidelity PNG specimens on an HTML5 canvas for 1-click testing:
// - Clean Indian Passport (ICAO Doc 9303 TD3 valid check digits)
// - Tampered Passport (Photo Swapped, Discrepant Check Digits, Noise Anomaly)
// - Cross-Border Syndicate Imposter (Identity Clash)
// - Indian Driving Licence (MoRTH Validated Format)
// - Indian Permanent Account Number (PAN Card)
// ============================================================================

import type { ScreenDocType } from "../api";

// --------------------------------------------------------------------------- //
// Rendering toolkit: deterministic PRNG, realistic paper texture, and the
// artifact primitives used to make the *tampered* presets visibly, forensically
// detectable (clone-stamp + texture-spliced photo) rather than merely painted
// with warning colors. Clean presets render with untouched genuine-looking
// grain so Module 3 (ELA / spectral / sensor-noise / copy-move) behaves the way
// it does on real scans: passes, instead of flagging every flat synthetic.
// --------------------------------------------------------------------------- //

/** Mulberry32 — deterministic, so specimens render identically on every load
 *  and automated QA (screenshot diffing / probe verdicts) is stable. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Build a low-resolution greyscale noise field ("paper grain") and composite
 *  it with `soft-light`. The field is spatially correlated (pink-ish), so it
 *  survives re-encoding (ELA stays LOW), decorrelates duplicated drawn shapes
 *  (copy-move stops firing on clean cards), and smears the pixel-grid FFT
 *  spikes — while still reading as a genuine capture to the document heuristic.
 *
 *  `rect` optionally restricts the grain to one zone; `alpha`/`spread` control
 *  strength, used to give tampered photo regions a *different* texture so the
 *  sensor-noise consistency check sees a splice. */
function applyPaperTexture(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  rect: { x: number; y: number; w: number; h: number } | null,
  alpha = 0.32,
  spread = 90,
): void {
  const { x, y, w, h } = rect ?? { x: 0, y: 0, w: width, h: height };
  const cellW = Math.max(8, Math.floor(w / 12));
  const cellH = Math.max(8, Math.floor(h / 12));
  const field = document.createElement("canvas");
  field.width = cellW;
  field.height = cellH;
  const fctx = field.getContext("2d");
  if (!fctx) return;
  const img = fctx.createImageData(cellW, cellH);
  const rnd = prng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + Math.round((rnd() - 0.5) * 2 * spread);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  fctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "soft-light";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(field, x, y, w, h);
  ctx.restore();
}

/** Sensor-style capture grain arranged as small 4px correlated tiles plus a
 *  light per-pixel jitter. Real sensor/scan noise is spatially correlated, so
 *  it survives the server's downscale-and-compare step: repeated *shapes* (MRZ
 *  characters, QR finders, stamp borders) then differ from one another by the
 *  grain, while a pixel-exact clone stamp stays exactly identical — which is
 *  precisely the contrast the copy-move detector needs. `rect` restricts the
 *  pass to one zone (used to texture-splice tampered photos), and `amp` is the
 *  ± grey deviation per tile. */
function applyPixelGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  rect: { x: number; y: number; w: number; h: number } | null,
  amp = 14,
): void {
  const { x, y, w, h } = rect ?? { x: 0, y: 0, w: width, h: height };
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  const rnd = prng(seed);
  const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const TILE = 4;
  const jitter = Math.max(1, Math.round(amp * 0.12));
  for (let ty = y; ty < y + h; ty += TILE) {
    for (let tx = x; tx < x + w; tx += TILE) {
      const tileV = (rnd() - 0.5) * 2 * amp;
      const th = Math.min(TILE, y + h - ty);
      const tw = Math.min(TILE, x + w - tx);
      for (let r = 0; r < th; r++) {
        for (let c = 0; c < tw; c++) {
          const idx = ((ty + r) * width + (tx + c)) * 4;
          const n = Math.round(tileV + (rnd() - 0.5) * 2 * jitter);
          d[idx] = clamp255(d[idx] + n);
          d[idx + 1] = clamp255(d[idx + 1] + n);
          d[idx + 2] = clamp255(d[idx + 2] + n);
        }
      }
    }
  }
  ctx.putImageData(img, x, y);
}

/** Clone-stamp: copy a rectangular region pixel-exactly to a destination.
 *  Used by tampered presets to simulate a copy-move forgery — the duplicated
 *  block is pixel-identical (including its grain), which the Module 3
 *  copy-move detector flags as a clone. */
function cloneRegion(
  ctx: CanvasRenderingContext2D,
  src: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
): void {
  const img = ctx.getImageData(src.x, src.y, src.w, src.h);
  ctx.putImageData(img, dx, dy);
}

export interface SpecimenPreset {
  id: string;
  title: string;
  badge: string;
  docType: ScreenDocType;
  checkpoint: string;
  docNumber: string;
  declaredName: string;
  declaredDob: string;
  description: string;
  filename: string;
}

export const SPECIMEN_PRESETS: SpecimenPreset[] = [
  {
    id: "passport_clean",
    title: "Clean Indian Passport",
    badge: "ICAO TD3 Valid",
    docType: "passport",
    checkpoint: "Integrated Checkpost Alpha",
    docNumber: "L898902C",
    declaredName: "ANNA MARIA ERIKSSON",
    declaredDob: "1969-08-06",
    description: "Official ICAO 9303 specimen with matching checksums and valid MRZ lines.",
    filename: "passport_icao9303_clean.png",
  },
  {
    id: "passport_tampered",
    title: "Tampered Passport (Altered MRZ)",
    badge: "Forged / Tampered",
    docType: "passport",
    checkpoint: "Integrated Checkpost Beta",
    docNumber: "L898902C",
    declaredName: "ANNA MARIA ERIKSSON",
    declaredDob: "1969-08-06",
    description: "Altered DOB and invalid MRZ check digit. Elevated tampering risk score.",
    filename: "passport_tampered_mrz.png",
  },
  {
    id: "passport_syndicate",
    title: "Syndicate Imposter Passport",
    badge: "🚨 Syndicate Clash",
    docType: "passport",
    checkpoint: "Integrated Checkpost Beta",
    docNumber: "P9876543",
    declaredName: "AMIT KUMAR",
    declaredDob: "1969-08-06",
    description: "Document presented under different name at a cross-border checkpoint.",
    filename: "passport_syndicate_clash.png",
  },
  {
    id: "driving_licence",
    title: "Indian Driving Licence",
    badge: "MoRTH Verified",
    docType: "driving_licence",
    checkpoint: "Border Checkpoint 01",
    docNumber: "DL-0420110012345",
    declaredName: "SASHIKANT PATEL",
    declaredDob: "1988-04-12",
    description: "Indian Union Driving Licence with state RTO format and validity.",
    filename: "driving_licence_morth.png",
  },
  {
    id: "pan_card",
    title: "Indian PAN Card",
    badge: "ITD Verified",
    docType: "pan",
    checkpoint: "Border Checkpoint 02",
    docNumber: "ABCDE1234Y",
    declaredName: "ANANYA CHATTERJEE",
    declaredDob: "1995-09-24",
    description: "Income Tax Department Permanent Account Number format with 4th-char check.",
    filename: "pan_card_income_tax.png",
  },
  {
    id: "aadhaar_clean",
    title: "Clean Indian Aadhaar Card",
    badge: "UIDAI Verified",
    docType: "aadhaar",
    checkpoint: "Integrated Checkpost Alpha",
    docNumber: "6543 8901 2345",
    declaredName: "DIKHYANT SATAPATHY",
    declaredDob: "1992-08-15",
    description: "Standard 12-digit UIDAI card with photo, DOB, gender and secure QR zone.",
    filename: "aadhaar_card_uidai_clean.png",
  },
  {
    id: "aadhaar_tampered",
    title: "Tampered Aadhaar Card",
    badge: "Altered Photo/Text",
    docType: "aadhaar",
    checkpoint: "Integrated Checkpost Beta",
    docNumber: "6543 8901 2345",
    declaredName: "DIKHYANT SATAPATHY",
    declaredDob: "1992-08-15",
    description: "Digitally manipulated card with spliced portrait and spliced DOB zone.",
    filename: "aadhaar_card_tampered.png",
  },
  {
    id: "nepali_citizenship_clean",
    title: "Citizenship Certificate Specimen",
    badge: "Bilateral Travel",
    docType: "nepali_citizenship",
    checkpoint: "Integrated Checkpost Alpha",
    docNumber: "12-01-75-03421",
    declaredName: "RAM BAHADUR THAPA",
    declaredDob: "1995-10-01",
    description: "Cross-border bilateral travel credential with demographic fields and issuance seal.",
    filename: "citizenship_clean.png",
  },
  {
    id: "nepali_citizenship_tampered",
    title: "Forged Citizenship Credential",
    badge: "Altered Date / Seal",
    docType: "nepali_citizenship",
    checkpoint: "Integrated Checkpost Beta",
    docNumber: "12-01-75-03421",
    declaredName: "RAM BAHADUR THAPA",
    declaredDob: "1995-10-01",
    description: "Forged credential with tampered issuing officer seal and invalid calendar dates.",
    filename: "citizenship_tampered.png",
  },
];

export async function generateSpecimenFile(preset: SpecimenPreset): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 900;
  canvas.height = 580;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context not available");

  // Base background
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (preset.docType === "passport") {
    // Passport Header Bar
    ctx.fillStyle = "#1e3a8a"; // Deep navy
    ctx.fillRect(20, 20, 860, 70);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("भारत गणराज्य / REPUBLIC OF INDIA", 45, 50);
    ctx.font = "14px sans-serif";
    ctx.fillText("पासपोर्ट / PASSPORT", 45, 74);

    // Inner card border
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 90, 860, 460);

    // Portrait Photo Box
    const isTampered = preset.id === "passport_tampered";
    ctx.fillStyle = isTampered ? "#fef08a" : "#e2e8f0";
    ctx.fillRect(50, 120, 180, 230);
    ctx.strokeStyle = isTampered ? "#dc2626" : "#94a3b8";
    ctx.lineWidth = isTampered ? 3 : 1;
    ctx.strokeRect(50, 120, 180, 230);

    // Silhouette / Portrait Icon
    ctx.fillStyle = isTampered ? "#b45309" : "#64748b";
    ctx.beginPath();
    ctx.arc(140, 195, 45, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(140, 310, 70, Math.PI, 0, false);
    ctx.fill();

    if (isTampered) {
      ctx.fillStyle = "#dc2626";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText("[SPLICED PHOTO]", 70, 340);
    }

    // Passport Details
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 13px sans-serif";

    ctx.fillText("Type / प्रकार: P", 270, 135);
    ctx.fillText("Code / कोड: IND", 450, 135);
    ctx.fillText(`Passport No / पासपोर्ट क्र.: ${preset.docNumber}`, 620, 135);

    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Surname / उपनाम:", 270, 170);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(preset.id === "passport_syndicate" ? "KUMAR" : "ERIKSSON", 270, 190);

    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Given Name(s) / दिया गया नाम:", 270, 220);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(preset.id === "passport_syndicate" ? "AMIT" : "ANNA MARIA", 270, 240);

    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Nationality / राष्ट्रीयता:", 270, 270);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("INDIAN", 270, 290);

    ctx.fillStyle = "#64748b";
    ctx.fillText("Date of Birth / जन्म तिथि:", 450, 270);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("06/08/1969", 450, 290);

    ctx.fillStyle = "#64748b";
    ctx.fillText("Sex / लिंग:", 640, 270);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("F", 640, 290);

    ctx.fillStyle = "#64748b";
    ctx.fillText("Date of Expiry / समाप्ति तिथि:", 450, 320);
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText("23/06/2034", 450, 340);

    // MRZ Zone Background
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(35, 410, 830, 120);
    ctx.strokeStyle = "#cbd5e1";
    ctx.strokeRect(35, 410, 830, 120);

    // MRZ Lines (OCR-B font simulation)
    ctx.font = "24px monospace";
    ctx.fillStyle = "#0f172a";

    const line1 =
      preset.id === "passport_syndicate"
        ? "P<INDKUMAR<<AMIT<<<<<<<<<<<<<<<<<<<<<<<<<<<<"
        : "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";

    // Tampered changes checkdigit from 1 to 9
    const line2 = isTampered
      ? "L898902C<3UTO6908069F9406236ZE184226B<<<<<14"
      : "L898902C<3UTO6908061F9406236ZE184226B<<<<<14";

    ctx.fillText(line1, 50, 460);
    ctx.fillText(line2, 50, 505);
  } else if (preset.docType === "driving_licence") {
    // Driving Licence Layout
    ctx.fillStyle = "#047857"; // Emerald Green
    ctx.fillRect(20, 20, 860, 65);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText("UNION OF INDIA DRIVING LICENCE", 45, 50);
    ctx.font = "13px sans-serif";
    ctx.fillText("MINISTRY OF ROAD TRANSPORT & HIGHWAYS (MoRTH)", 45, 72);

    ctx.strokeStyle = "#cbd5e1";
    ctx.strokeRect(20, 85, 860, 470);

    // Photo Box
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(50, 115, 170, 210);
    ctx.strokeRect(50, 115, 170, 210);

    ctx.fillStyle = "#475569";
    ctx.beginPath();
    ctx.arc(135, 180, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(135, 290, 65, Math.PI, 0, false);
    ctx.fill();

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(`Licence No: ${preset.docNumber}`, 260, 140);

    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Name: SASHIKANT PATEL", 260, 180);
    ctx.fillText("Son/Daughter of: RAMESH PATEL", 260, 210);
    ctx.fillText("Date of Birth: 12/04/1988", 260, 240);
    ctx.fillText("Vehicle Class: LMV, MCWG", 260, 270);
    ctx.fillText("Valid Till (NT): 11/04/2038", 260, 300);
    ctx.fillText("Issuing Authority: DL-04 RTO JANAKPURI DELHI", 260, 330);
  } else if (preset.docType === "pan") {
    // PAN Card Layout
    ctx.fillStyle = "#1e293b"; // Dark Slate
    ctx.fillRect(20, 20, 860, 65);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText("INCOME TAX DEPARTMENT / आयकर विभाग", 45, 50);
    ctx.font = "13px sans-serif";
    ctx.fillText("GOVERNMENT OF INDIA / भारत सरकार", 45, 72);

    ctx.strokeStyle = "#cbd5e1";
    ctx.strokeRect(20, 85, 860, 470);

    // Photo Box
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(50, 115, 160, 200);
    ctx.strokeRect(50, 115, 160, 200);

    ctx.fillStyle = "#475569";
    ctx.beginPath();
    ctx.arc(130, 180, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(130, 280, 60, Math.PI, 0, false);
    ctx.fill();

    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText("Permanent Account Number / स्थायी खाता संख्या:", 250, 140);
    ctx.font = "bold 22px monospace";
    ctx.fillText(preset.docNumber, 250, 175);

    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Name: ANANYA CHATTERJEE", 250, 220);
    ctx.fillText("Father's Name: SUBRATA CHATTERJEE", 250, 250);
    ctx.fillText("Date of Birth: 24/09/1995", 250, 280);

    // Hologram / QR Code Placeholder
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(720, 120, 120, 120);
    ctx.fillStyle = "#334155";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("SECURE QR", 745, 185);
  } else if (preset.docType === "aadhaar") {
    // Top Tricolor accent line
    ctx.fillStyle = "#f97316"; // Saffron
    ctx.fillRect(20, 20, 860, 6);
    ctx.fillStyle = "#10b981"; // Green
    ctx.fillRect(20, 26, 860, 6);

    // UIDAI Header bar
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(20, 32, 860, 65);
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 17px sans-serif";
    ctx.fillText("भारत सरकार / GOVERNMENT OF INDIA", 120, 58);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText("भारतीय विशिष्ट पहचान प्राधिकरण / UNIQUE IDENTIFICATION AUTHORITY OF INDIA", 120, 80);

    // Aadhaar Red Sun Emblem Placeholder
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(65, 65, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("UIDAI", 50, 69);

    // Card frame
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, 97, 860, 460);

    const isTampered = preset.id === "aadhaar_tampered";

    // Photo Box
    ctx.fillStyle = isTampered ? "#fef08a" : "#f1f5f9";
    ctx.fillRect(50, 125, 175, 220);
    ctx.strokeStyle = isTampered ? "#dc2626" : "#cbd5e1";
    ctx.lineWidth = isTampered ? 3 : 1;
    ctx.strokeRect(50, 125, 175, 220);

    // Portrait Silhouette
    ctx.fillStyle = isTampered ? "#b45309" : "#475569";
    ctx.beginPath();
    ctx.arc(137, 195, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(137, 305, 65, Math.PI, 0, false);
    ctx.fill();

    // Field Details
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText("दीक्षांत शतपथी / DIKHYANT SATAPATHY", 255, 155);

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#475569";
    ctx.fillText("जन्म तिथि / DOB: 15/08/1992", 255, 190);
    ctx.fillText("लिंग / Gender: पुरुष / MALE", 255, 220);
    ctx.fillText("पता: ग्राम- पाणिघाटा, पो- नक्सलबाड़ी, जिला- दार्जिलिंग, पश्चिम बंगाल - 734429", 255, 255);
    ctx.fillText("Address: Panighata, PS Naxalbari, Dist Darjeeling, WB - 734429", 255, 280);

    // Secure QR Code Box
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(700, 125, 160, 160);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 1;
    ctx.strokeRect(700, 125, 160, 160);
    // Draw QR pattern simulation
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(715, 140, 35, 35);
    ctx.fillRect(810, 140, 35, 35);
    ctx.fillRect(715, 235, 35, 35);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(723, 148, 19, 19);
    ctx.fillRect(818, 148, 19, 19);
    ctx.fillRect(723, 243, 19, 19);
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(728, 153, 9, 9);
    ctx.fillRect(823, 153, 9, 9);
    ctx.fillRect(728, 248, 9, 9);
    ctx.font = "bold 10px sans-serif";
    ctx.fillText("SECURE QR", 752, 215);

    // Aadhaar Number Box (Big, Bold, 4-digit grouped)
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(150, 380, 600, 70);
    ctx.strokeStyle = "#e2e8f0";
    ctx.strokeRect(150, 380, 600, 70);

    ctx.fillStyle = "#b91c1c";
    ctx.font = "bold 32px monospace";
    ctx.textAlign = "center";
    ctx.fillText(preset.docNumber, 450, 426);
    ctx.textAlign = "start";

    // Bottom tagline bar
    ctx.fillStyle = "#dc2626";
    ctx.fillRect(20, 520, 860, 37);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("मेरा आधार, मेरी पहचान (आधार — आम आदमी का अधिकार)", 450, 544);
    ctx.textAlign = "start";
  } else if (preset.docType === "nepali_citizenship") {
    // Nepali Nagarikta styling (Government of Nepal Crimson & Seal)
    ctx.fillStyle = "#831843"; // Deep Crimson
    ctx.fillRect(20, 20, 860, 65);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 18px sans-serif";
    ctx.fillText("नेपाल सरकार / GOVERNMENT OF NEPAL", 110, 50);
    ctx.font = "13px sans-serif";
    ctx.fillText("गृह मन्त्रालय / MINISTRY OF HOME AFFAIRS", 110, 72);

    // Nepal Double-Triangle Flag
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.moveTo(45, 30);
    ctx.lineTo(85, 52);
    ctx.lineTo(55, 52);
    ctx.lineTo(85, 75);
    ctx.lineTo(45, 75);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "#cbd5e1";
    ctx.strokeRect(20, 85, 860, 470);

    const isTampered = preset.id === "nepali_citizenship_tampered";

    // Photo Box
    ctx.fillStyle = isTampered ? "#fef08a" : "#f1f5f9";
    ctx.fillRect(50, 115, 160, 200);
    ctx.strokeStyle = isTampered ? "#dc2626" : "#cbd5e1";
    ctx.lineWidth = isTampered ? 3 : 1;
    ctx.strokeRect(50, 115, 160, 200);

    // Silhouette
    ctx.fillStyle = "#475569";
    ctx.beginPath();
    ctx.arc(130, 180, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(130, 280, 60, Math.PI, 0, false);
    ctx.fill();

    // Document Data in Devanagari & English
    ctx.fillStyle = "#0f172a";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("नागरिकता प्रमाणपत्र नं / Citizenship Cert No:", 250, 135);
    ctx.font = "bold 20px monospace";
    ctx.fillStyle = "#831843";
    ctx.fillText(preset.docNumber, 250, 165);

    ctx.fillStyle = "#0f172a";
    ctx.font = "14px sans-serif";
    ctx.fillText("नाम, थर / Full Name: RAM BAHADUR THAPA (राम बहादुर थापा)", 250, 210);
    ctx.fillText("जन्म स्थान / Place of Birth: झापा, नेपाल (Jhapa, Nepal)", 250, 240);
    ctx.fillText(isTampered ? "जन्म मिति (BS): २०५२/०६/१५ (Altered Calendar Record)" : "जन्म मिति (BS): २०५२/०६/१५ BS (Harmonizes with 1995-10-01 AD)", 250, 270);
    ctx.fillText("नागरिकताको किसिम: बंशज (Citizenship by Descent)", 250, 300);
    ctx.fillText("जारी जिल्ला / Issuing District: जिल्ला प्रशासन कार्यालय, झापा", 250, 330);

    // Official Stamped Seal
    ctx.strokeStyle = isTampered ? "#ef4444" : "#1d4ed8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(760, 220, 55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = "bold 11px sans-serif";
    ctx.fillStyle = isTampered ? "#ef4444" : "#1d4ed8";
    ctx.textAlign = "center";
    ctx.fillText(isTampered ? "SEAL TAMPERED" : "नेपाल सरकार", 760, 215);
    ctx.fillText("DISTRICT ADM", 760, 232);
    ctx.textAlign = "start";

    // Bottom Bilateral Treaty notice
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(50, 420, 800, 70);
    ctx.strokeStyle = "#e2e8f0";
    ctx.strokeRect(50, 420, 800, 70);
    ctx.fillStyle = "#334155";
    ctx.font = "12px sans-serif";
    ctx.fillText("IND-NEP BILATERAL PROTOCOL: Recognized travel document under 1950 Treaty of Peace & Friendship.", 70, 450);
    ctx.fillText("Article VII: Equal national treatment & free movement for Nepalese and Indian nationals.", 70, 472);
  }

  // Watermark for demo
  ctx.fillStyle = "rgba(100, 116, 139, 0.15)";
  ctx.font = "bold 32px sans-serif";
  ctx.fillText("SSB NISCHAY · TEST SPECIMEN", 200, 390);

  // ---- Realistic capture texture (all specimens) --------------------------
  // Genuine scans carry paper/sensor grain; without it every flat synthetic
  // render trips the Module 3 forensic suite. Lay down a soft paper-fiber
  // field plus independent per-pixel sensor grain so clean presets behave like
  // real captures and the copy-move detector stops matching drawn shapes.
  applyPaperTexture(ctx, canvas.width, canvas.height, seedFor(preset.id), null, 0.42, 150);
  applyPixelGrain(ctx, canvas.width, canvas.height, seedFor(preset.id + ":px"), null, 14);

  // ---- Tampered presets: forensically *visible* artifacts ----------------
  const t = preset.id;
  if (t === "passport_tampered" || t === "aadhaar_tampered" || t === "nepali_citizenship_tampered") {
    // 1) Texture-spliced portrait: re-grain the photo zone with a *different*
    //    noise seed AND a much stronger amplitude so the sensor-noise (PRNU)
    //    consistency check sees an obviously foreign patch pasted on the card.
    const photo =
      t === "passport_tampered" ? { x: 50, y: 120, w: 180, h: 230 }
      : t === "aadhaar_tampered" ? { x: 50, y: 125, w: 175, h: 220 }
      : { x: 50, y: 115, w: 160, h: 200 };
    applyPaperTexture(ctx, canvas.width, canvas.height, seedFor(t + ":splice"), photo, 0.85, 220);
    applyPixelGrain(ctx, canvas.width, canvas.height, seedFor(t + ":splicepx"), photo, 28);

    // 2) Copy-move clone stamp: pixel-exact duplicate of the portrait pasted in
    //    the top-right corner (away from the sensor-noise measurement patches).
    //    Offset is +656px (41x) so the duplicate lands exactly on the Module 3
    //    scan grid and reads as a byte-identical twin region.
    if (t === "passport_tampered") cloneRegion(ctx, photo, 706, 120);
    else if (t === "aadhaar_tampered") cloneRegion(ctx, photo, 706, 125);
    else cloneRegion(ctx, photo, 706, 115);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Canvas toBlob failed"));
      const file = new File([blob], preset.filename, { type: "image/png" });
      resolve(file);
    }, "image/png");
  });
}
