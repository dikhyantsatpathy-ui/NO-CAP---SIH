---
name: border-screening-operations
description: Guides border checkpoint screening protocols, bilateral treaties (Indo-Nepal 1950 Treaty, Indo-Bhutan travel regulations), SSB checkpoint sectors (Panitanki, Raxaul, Sonauli, Jaigaon), and cross-border syndicate intelligence analysis. Use when updating screening workflows, guide catalogs, or syndicate pattern detection.
---

# Border Screening Operations & Cross-Border Intelligence

## Overview

Sashastra Seema Bal (SSB), under the Ministry of Home Affairs (MHA) Police II Division, guards 1,751 km of the open Indo-Nepal border and 699 km of the Indo-Bhutan border. Checkpoints handle immense daily transit volumes where physical barricades are minimal and bilateral treaties govern document requirements.

---

## 1. Checkpoint Clusters & Operational Theaters

| Cluster | Code | Primary Posts | Key Operational Constraints |
|---|---|---|---|
| **Indo-Nepal Land** | `LAND_NEPAL` | Panitanki (Siliguri corridor), Raxaul (Bihar), Sonauli (Gorakhpur), Jogbani (Araria) | Visa-free for Indian & Nepali nationals. High vulnerability to third-country nationals impersonating locals with forged Aadhaar or voter IDs. |
| **Indo-Bhutan Land** | `LAND_BHUTAN` | Jaigaon (Alipurduar), Dadgiri, Gelephu, Samdrup Jongkhar | Bilateral entry permits. Free movement for citizens with designated national photo IDs. |
| **International Air** | `AIR` | IGI New Delhi, Mumbai, Kolkata, Bagdogra | Strict ICAO Doc 9303 compliance, electronic visa (e-Visa) verification, full biometrics mandatory. |
| **Sea & Rail** | `SEA` / `RAIL` | Petrapole Rail, Haldia Port, Nhava Sheva | Manifest-driven passenger and cargo crew document screening. |

---

## 2. Treaty-Aware Document Protocols

### 1950 Indo-Nepal Treaty of Peace and Friendship
- **Nepali Citizens Entering India**:
  - Acceptable documents: Nepali Passport, Nepali Citizenship Certificate, Voter Identity Card issued by the Election Commission of Nepal, or Identity Certificate issued by Nepal's diplomatic missions in India.
  - Indian Visa is **NOT** required.
- **Indian Citizens Entering Nepal**:
  - Acceptable documents: Indian Passport, Voter Identity Card issued by the Election Commission of India, or Emergency/Identity Certificate issued by the Embassy of India, Kathmandu.
  - Note: Aadhaar cards and Driving Licences are legally not recognized for international air travel under MHA directives, but are frequently presented at open land crossings.
- **Third-Country Nationals (Foreign Citizens)**:
  - **MANDATORY**: Valid national passport and valid Indian visa (or OCI card). Land entry must occur strictly through designated Integrated Check Posts (ICPs) with immigration counters.

---

## 3. Cross-Border Syndicate Threat Detection

Human trafficking and illegal infiltration syndicates operate across multiple border posts simultaneously. When a forged document is detected, the system correlates attributes against historical screening logs:

### Fraud Correlation Vectors
1. **Shared Document Serials**: Identical card number presented at two different checkpoints within physically impossible travel windows (e.g. Sonauli and Panitanki within 2 hours).
2. **Template Re-use**: Identical ELA error distributions or font rendering anomalies across different names, indicating a common counterfeiting workshop.
3. **Ghost Issuing Authorities**: State/district codes that do not exist or were issued outside legitimate date windows.
4. **Biometric Face Clones**: Same facial embedding attempting entry under different names and nationalities.

---

## 4. Standard Operating Procedure (SOP) at Screening Desk

1. **Intake & Classification**:
   - Operator selects active checkpoint cluster and traveller declared nationality.
   - Live document is captured via overhead scanner or USB kiosk camera.
   - Document type auto-classified or declared.
2. **Four-Module Execution**:
   - M1 OCR & MRZ parsed in-memory.
   - M2 Checksum & expiry validated against treaty rules.
   - M3 ELA & sensor noise forensics evaluated.
   - M4 Live webcam face matched against document portrait with age-aware threshold.
3. **Adjudication**:
   - Risk Score $0 - 29$: `ALLOW` (Expedited Clearance).
   - Risk Score $30 - 69$: `REFER` (Secondary Inspection / Officer Interview).
   - Risk Score $70 - 100$: `REJECT` (Immediate Detention / Impound / Flagged Alert).
4. **Custody & Evidence**:
   - Block hash generated and appended to local ledger.
   - BSA 2023 s.65B electronic certificate produced if flagged for prosecution.
