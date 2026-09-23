---
name: document-forensics-and-tamper-detection
description: Guides image forgery and document tampering analysis for identity documents (SIH26188 Module 3). Use when inspecting, calibrating, or developing forensic detectors including JPEG Error Level Analysis (ELA), 2D-FFT spectral PAPR, Photo-Response Non-Uniformity (PRNU) sensor noise correlation, Laplacian blur variance, and copy-move tampering.
---

# Document Forensics & Tamper Detection (Module 3)

## Overview

Module 3 of the SIH26188 screening architecture provides deterministic, explainable physical and digital tampering analysis of identity documents presented at border checkpoints. It operates strictly offline with zero external dependencies beyond NumPy, SciPy, and Pillow.

All forensic algorithms must produce:
1. A normalized numerical score ($0.0 \le s \le 1.0$).
2. An explainable human-readable finding for the border screening officer.
3. An optional visualization artifact (e.g. ELA difference heatmap) without persisting raw document bytes to disk.

---

## 1. Error Level Analysis (ELA)

### Physics & Principle
JPEG compression divides images into $8 \times 8$ pixel blocks and applies discrete cosine transform (DCT) quantization. When an image is modified (e.g., photo replaced, text altered) and re-saved, the modified region is compressed once while the unmodified background has undergone multiple compression generations. This produces an error disparity when re-compressed at a known quality level.

### Implementation Pattern

```python
import io
import numpy as np
from PIL import Image, ImageChops, ImageEnhance

def compute_ela(image_bytes: bytes, quality: int = 90, scale: float = 15.0) -> dict:
    """
    Computes Error Level Analysis on image bytes without writing to disk.
    
    Args:
        image_bytes: Raw JPEG/PNG image data in memory.
        quality: Re-compression target quality (90-95 is optimal).
        scale: Multiplier to enhance low-amplitude error differences.
        
    Returns:
        dict containing mean_error, max_error, anomaly_detected, and visual heatmap bytes.
    """
    orig = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    
    # In-memory resave at target quality
    buf = io.BytesIO()
    orig.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    resaved = Image.open(buf)
    
    # Absolute difference between original and resaved
    diff = ImageChops.difference(orig, resaved)
    
    # Scale difference for visual inspection
    extrema = diff.getextrema()
    max_diff = max([ex[1] for ex in extrema])
    if max_diff == 0:
        max_diff = 1
    scale_factor = 255.0 / max_diff
    enhanced = ImageEnhance.Brightness(diff).enhance(scale_factor)
    
    # Numerical error metrics
    diff_arr = np.array(diff, dtype=np.float32)
    mean_error = float(np.mean(diff_arr))
    p95_error = float(np.percentile(diff_arr, 95))
    
    # Thresholds: natural camera shots ~ 2.0 - 6.0; spliced composites > 12.0
    is_tampered = p95_error > 14.0 or mean_error > 8.0
    
    return {
        "mean_error": round(mean_error, 3),
        "p95_error": round(p95_error, 3),
        "is_tampered": is_tampered,
        "verdict": "ANOMALY_DETECTED" if is_tampered else "UNIFORM_COMPRESSION",
    }
```

---

## 2. 2D-FFT Spectral Analysis (PAPR)

### Physics & Principle
Digital tampering (rescaling, periodic cloning, GAN checkerboard artifacts, or diffusion model super-resolution) disrupts the natural $1/f^\alpha$ power spectral distribution of authentic photographs. It introduces sharp, periodic spikes in the frequency domain.

The Peak-to-Average Power Ratio (PAPR) in the 2D frequency spectrum measures this irregularity:
$$\text{PAPR} = \frac{\max(|F(u, v)|^2)}{\frac{1}{MN} \sum_{u, v} |F(u, v)|^2}$$

### Implementation Pattern

```python
import numpy as np
from PIL import Image

def compute_spectral_papr(image: Image.Image) -> dict:
    """
    Calculates 2D-FFT Peak-to-Average Power Ratio (PAPR).
    Synthetic/AI-generated or heavily edited documents exhibit unnatural spectral spikes.
    """
    gray = image.convert("L").resize((256, 256))
    arr = np.asarray(gray, dtype=np.float32)
    
    # 2D Fast Fourier Transform with zero-frequency shifted to centre
    f_transform = np.fft.fft2(arr)
    f_shift = np.fft.fftshift(f_transform)
    magnitude_spectrum = np.abs(f_shift) ** 2
    
    # Mask DC component (centre 5x5 window) to avoid biasing with average brightness
    cy, cx = 128, 128
    magnitude_spectrum[cy-2:cy+3, cx-2:cx+3] = 0.0
    
    mean_power = np.mean(magnitude_spectrum)
    max_power = np.max(magnitude_spectrum)
    
    papr = float(max_power / (mean_power + 1e-9))
    
    # Natural photos typically have PAPR in range 12.0 - 45.0
    # Resampled / GAN / synthetic images exhibit PAPR > 80.0
    anomaly = papr > 75.0 or papr < 4.0
    
    return {
        "papr_score": round(papr, 2),
        "spectral_anomaly": anomaly,
        "detail": "Periodic frequency spikes detected (potential digital manipulation)" if anomaly else "Natural frequency decay"
    }
```

---

## 3. PRNU Sensor Noise Consistency

### Physics & Principle
Every camera sensor (CMOS/CCD) possesses unique physical imperfections in silicon that impart a deterministic Photo-Response Non-Uniformity (PRNU) noise pattern onto every captured image. When a portrait or text box is spliced into a document from a different source, the PRNU noise residual between the spliced patch and the document substrate does not correlate.

### Implementation Pattern

```python
import numpy as np
from scipy.ndimage import median_filter
from PIL import Image

def compute_noise_consistency(image: Image.Image, patch_boxes: list[tuple[int, int, int, int]] | None = None) -> dict:
    """
    Extracts sensor noise residual by subtracting median-filtered denoised image.
    Evaluates noise variance consistency across the document.
    """
    gray = image.convert("L")
    arr = np.asarray(gray, dtype=np.float32)
    
    # Wavelet or median filter estimate of the scene content
    denoised = median_filter(arr, size=3)
    noise_residual = arr - denoised
    
    global_noise_std = float(np.std(noise_residual))
    
    # Check quad split (4 corners) for inter-region consistency
    h, w = arr.shape
    q1 = noise_residual[0:h//2, 0:w//2]
    q2 = noise_residual[0:h//2, w//2:]
    q3 = noise_residual[h//2:, 0:w//2]
    q4 = noise_residual[h//2:, w//2:]
    
    stds = [float(np.std(q)) for q in (q1, q2, q3, q4)]
    max_dev = max(stds) / (min(stds) + 1e-6)
    
    # Significant deviation (>2.8x) indicates composite assembly from distinct cameras
    inconsistent = max_dev > 2.8 and global_noise_std > 1.5
    
    return {
        "global_noise_std": round(global_noise_std, 3),
        "max_variance_ratio": round(max_dev, 2),
        "noise_consistent": not inconsistent,
        "verdict": "COMPOSITE_SENSOR_DISPARITY" if inconsistent else "UNIFORM_SENSOR_GRAIN"
    }
```

---

## 4. Laplacian Variance Blur & Edge Splicing

### Physics & Principle
Spliced text or portraits often have sharp boundary discontinuities or unnatural blur mismatch compared to the host card substrate. Computing the variance of the Laplacian filter identifies out-of-focus fields and paste-board borders.

$$\sigma^2 = \text{Var}(\nabla^2 I)$$

---

## 5. False-Positive Calibration Checklist

When deploying to remote SSB border checkposts (Panitanki, Raxaul, Sonauli):
- [ ] **Dust & Lens Scratches**: Checkpoint cameras often have dirty lenses that produce localized noise. Never trigger a forgery verdict on PRNU alone without corroborating ELA or MRZ failure.
- [ ] **WhatsApp / Messaging Compression**: Travellers often present photos re-compressed by WhatsApp (720p, high quantization). Recognize double-compression artifacts ($P95$ plateau) vs actual content splicing.
- [ ] **Lamination Reflections**: Plastic lamination on Indian Voter IDs and Nepali Citizenship Cards causes high specular reflection. Ensure reflection zones are masked before FFT analysis.
- [ ] **Explainability Requirement**: Never output a binary "FAKE" or "REAL". Always output the contributing signals (e.g. `M3_ELA_ANOMALY (weight 0.35)`, `M2_MRZ_CHECKSUM_MISMATCH (weight 0.45)`).
