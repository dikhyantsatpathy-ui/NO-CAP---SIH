---
name: icao-9303-mrz-and-id-validation
description: Guides parsing and mathematical validation of Machine Readable Zones (ICAO Doc 9303 TD1, TD2, TD3) and national identity documents (Aadhaar Verhoeff, PAN, Voter ID, Driving Licence, Nepali Citizenship). Use when implementing or testing Module 1 and Module 2 document format and checksum rules.
---

# ICAO Doc 9303 MRZ & National ID Validation (Module 1 & 2)

## Overview

Module 1 & 2 provides deterministic parsing and cryptographic/arithmetic validation of identity documents. Fraudulent documents frequently exhibit typographical or check-digit anomalies that can be caught in milliseconds before running heavier neural pipelines.

---

## 1. ICAO Doc 9303 Checksum Weighting (7-3-1 Algorithm)

ICAO 9303 specifies a repeating weight sequence `[7, 3, 1]` applied to character ordinal values, calculated modulo 10:

### Character Mapping Table
- `0`-`9`: numeric value `0`-`9`
- `A`-`Z`: value `10`-`35`
- `<`: filler character, value `0`

### Formula
$$\text{Checksum} = \left(\sum_{i=0}^{n-1} \text{value}(c_i) \times w_{i \pmod 3}\right) \pmod{10}$$

### Implementation Pattern

```python
ICAO_WEIGHTS = [7, 3, 1]

def icao_char_value(c: str) -> int:
    if c.isdigit():
        return int(c)
    if 'A' <= c.upper() <= 'Z':
        return ord(c.upper()) - ord('A') + 10
    return 0  # '<' filler or unknown

def calculate_icao_check_digit(data: str) -> int:
    total = 0
    for idx, char in enumerate(data):
        weight = ICAO_WEIGHTS[idx % 3]
        total += icao_char_value(char) * weight
    return total % 10

def verify_icao_field(data: str, expected_digit: str) -> bool:
    if not expected_digit.isdigit():
        return False
    return calculate_icao_check_digit(data) == int(expected_digit)
```

---

## 2. Standard MRZ Geometries

| Type | Dimensions | Common Uses | Line Format |
|---|---|---|---|
| **TD1** | 3 lines × 30 chars | National Identity Cards, Driving Licences | Line 1: Doc Type + Issuing State + Doc No.<br>Line 2: DOB + Sex + Expiry + Nationality<br>Line 3: Holder Name |
| **TD2** | 2 lines × 36 chars | Official Travel Documents, Visas | Line 1: Doc Type + Issuing State + Name<br>Line 2: Doc No. + Nationality + DOB + Expiry |
| **TD3** | 2 lines × 44 chars | Standard International Passports | Line 1: `P<` + State + Surname + Given Names<br>Line 2: Passport No. + Nationality + DOB + Expiry |

---

## 3. Indian Identity Document Validation Rules

### A. Aadhaar (12 Digits — Verhoeff Checksum)
The 12th digit of an Indian Aadhaar number is a Verhoeff checksum based on the dihedral group $D_5$.

```python
# Verhoeff tables
VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]

VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

def validate_verhoeff(num_str: str) -> bool:
    digits = [int(c) for c in num_str if c.isdigit()]
    if len(digits) != 12:
        return False
    c = 0
    for idx, item in enumerate(reversed(digits)):
        c = VERHOEFF_D[c][VERHOEFF_P[idx % 8][item]]
    return c == 0
```

### B. PAN (Permanent Account Number — 10 Characters)
Format: `[A-Z]{3}[CPHFATBLJG][A-Z][0-9]{4}[A-Z]`
- Chars 1-3: Alphabetic series (`AAA` to `ZZZ`)
- Char 4: Taxpayer status (`P` = Individual, `C` = Company, `H` = HUF, `F` = Firm, `A` = AOP, `T` = Trust, etc.)
- Char 5: First letter of cardholder's surname
- Chars 6-9: Sequential 4-digit number (`0001` to `9999`)
- Char 10: Alphabetic check character

### C. Indian Voter ID (EPIC)
Format: `[A-Z]{3}[0-9]{7}`
- 3 uppercase letters (assembly constituency prefix, e.g. `ABC`, `WBK`, `DLH`) followed by 7 serial digits.

### D. Driving Licence (DL)
Format: `[A-Z]{2}[0-9]{2}[0-9]{4}[0-9]{7}` (or variations up to 16 characters)
- First 2 letters: 2-letter state code (`DL`, `MH`, `UP`, `WB`, `BR`, `JH`)
- Next 2 digits: RTO code
- Next 4 digits: License issue year
- Remaining digits: Unique driving licence serial number

---

## 4. International Travel Validity Rules

- **6-Month Passport Rule**: Many immigration authorities require standard passports to have at least 6 months remaining validity beyond the date of entry. Flag `EXPIRING_SOON` if expiry is within 180 days.
- **Expiry Check**: Always flag `DOCUMENT_EXPIRED` if `expiry_date < current_screening_date`.
