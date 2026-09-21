// ============================================================================
// Synthetic Document Specimen Generator for SIH26188 Screening Desk
// Generates high-fidelity PNG specimens on an HTML5 canvas for 1-click testing:
// - Clean Indian Passport (ICAO Doc 9303 TD3 valid check digits)
// - Tampered Passport (Photo Swapped, Discrepant Check Digits, Noise Anomaly)
// - Cross-Border Syndicate Imposter (Panitanki / Raxaul Identity Clash)
// - Indian Driving Licence (MoRTH Validated Format)
// - Indian Permanent Account Number (PAN Card)
// ============================================================================

import type { ScreenDocType } from "../api";

export interface SpecimenPreset {
  id: string;
  title: string;
  badge: string;
  docType: ScreenDocType;
  checkpoint: string;
  docNumber: string;
  description: string;
  filename: string;
}

export const SPECIMEN_PRESETS: SpecimenPreset[] = [
  {
    id: "passport_clean",
    title: "Clean Indian Passport",
    badge: "ICAO TD3 Valid",
    docType: "passport",
    checkpoint: "Raxaul ICP (Bihar/Nepal Border)",
    docNumber: "L898902C",
    description: "Official ICAO 9303 specimen with matching checksums and valid MRZ lines.",
    filename: "passport_icao9303_clean.png",
  },
  {
    id: "passport_tampered",
    title: "Tampered Passport (Altered MRZ)",
    badge: "Forged / Tampered",
    docType: "passport",
    checkpoint: "Panitanki ICP (WB/Nepal Border)",
    docNumber: "L898902C",
    description: "Altered DOB and invalid MRZ check digit. Elevated tampering risk score.",
    filename: "passport_tampered_mrz.png",
  },
  {
    id: "passport_syndicate",
    title: "Syndicate Imposter Passport",
    badge: "🚨 Syndicate Clash",
    docType: "passport",
    checkpoint: "Panitanki ICP (WB/Nepal Border)",
    docNumber: "P9876543",
    description: "Document presented under different name at a cross-border checkpoint.",
    filename: "passport_syndicate_clash.png",
  },
  {
    id: "driving_licence",
    title: "Indian Driving Licence",
    badge: "MoRTH Verified",
    docType: "driving_licence",
    checkpoint: "Jogbani ICP (Bihar/Nepal Border)",
    docNumber: "DL-0420110012345",
    description: "Indian Union Driving Licence with state RTO format and validity.",
    filename: "driving_licence_morth.png",
  },
  {
    id: "pan_card",
    title: "Indian PAN Card",
    badge: "ITD Verified",
    docType: "pan",
    checkpoint: "Jaigaon ICP (WB/Bhutan Border)",
    docNumber: "ABCDE1234F",
    description: "Income Tax Department Permanent Account Number format with 4th-char check.",
    filename: "pan_card_income_tax.png",
  },
  {
    id: "aadhaar_clean",
    title: "Clean Indian Aadhaar Card",
    badge: "UIDAI Verified",
    docType: "aadhaar",
    checkpoint: "Panitanki ICP (WB/Nepal Border)",
    docNumber: "6543 8901 2345",
    description: "Standard 12-digit UIDAI card with photo, DOB, gender and secure QR zone.",
    filename: "aadhaar_card_uidai_clean.png",
  },
  {
    id: "aadhaar_tampered",
    title: "Tampered Aadhaar Card",
    badge: "Altered Photo/Text",
    docType: "aadhaar",
    checkpoint: "Raxaul ICP (Bihar/Nepal Border)",
    docNumber: "6543 8901 2345",
    description: "Digitally manipulated card with spliced portrait and spliced DOB zone.",
    filename: "aadhaar_card_tampered.png",
  },
  {
    id: "nepali_citizenship_clean",
    title: "Nepali Nagarikta (Citizenship Cert)",
    badge: "1950 Treaty Bilateral",
    docType: "nepali_citizenship",
    checkpoint: "Panitanki ICP (WB/Nepal Border)",
    docNumber: "12-01-75-03421",
    description: "Government of Nepal Citizenship Certificate (नेपाली नागरिकता प्रमाणपत्र) with Bikram Sambat date.",
    filename: "nepali_nagarikta_clean.png",
  },
  {
    id: "nepali_citizenship_tampered",
    title: "Forged Nepali Nagarikta",
    badge: "Altered BS Date / Seal",
    docType: "nepali_citizenship",
    checkpoint: "Raxaul ICP (Bihar/Nepal Border)",
    docNumber: "12-01-75-03421",
    description: "Forged citizenship document with tampered issuing officer seal and invalid Bikram Sambat calendar date.",
    filename: "nepali_nagarikta_tampered.png",
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

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Canvas toBlob failed"));
      const file = new File([blob], preset.filename, { type: "image/png" });
      resolve(file);
    }, "image/png");
  });
}
