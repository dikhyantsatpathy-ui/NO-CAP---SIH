---
title: No Cap ML Microservice
emoji: 🛡️
colorFrom: blue
colorTo: indigo
sdk: gradio
app_file: app.py
pinned: false
---

# No-Cap ML Microservice

Dedicated high-performance computer vision and AI microservice for the SSB Border Screening Desk.

## Included Models
- **YOLOv8 Document & Card Boundary / Semantic ROI Detector** (`card.onnx`)
- **5-Class Aadhaar Field Zone Detector** (`aadhaar_fields.onnx`)
- **ArcFace / InsightFace Biometric Portrait Matcher** (`w600k_r50.onnx`)
- **ViT-Base CIFAKE Deepfake & AI Image Forensics Classifier** (`onnx-community/ai-image-detection-ONNX`)

## Endpoints
- `GET /health` - Microservice health and model availability status
- `POST /api/ml/yolo_roi` - Extract normalized document, photo, QR, and MRZ zones
- `POST /api/ml/aadhaar_fields` - Detect Aadhaar semantic field coordinates
- `POST /api/ml/face_match` - Compare document portrait against live webcam capture
- `POST /api/ml/detect_image` - Vision Transformer AI-generation classification
