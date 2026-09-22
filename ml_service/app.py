import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from main import app as fastapi_app, _model_dir, _model_path

try:
    import spaces
    @spaces.GPU
    def zero_gpu_anchor():
        return True
except Exception:
    pass

try:
    import gradio as gr

    def get_status():
        models_dir = _model_dir()
        face_model = (
            os.path.exists(os.path.join(models_dir, "w600k_r50.onnx"))
            or os.path.exists(os.path.abspath(os.path.join(models_dir, "..", "..", "data", "models", "w600k_r50.onnx")))
            or bool(os.getenv("FACE_EMBED_MODEL"))
        )
        return {
            "service": "No-Cap AI/ML Microservice",
            "status": "Online & Healthy 🚀",
            "models": {
                "yolo_card": "Active" if os.path.exists(os.path.join(models_dir, "card.onnx")) else "Offline",
                "aadhaar_fields": "Active" if os.path.exists(os.path.join(models_dir, "aadhaar_fields.onnx")) else "Offline",
                "face_embed": "Active" if face_model else "Standby (Auto-Download)",
                "ai_detector": "Active" if os.path.exists(_model_path()) else "Standby (Auto-Download)",
            },
            "endpoints": [
                "/health",
                "/api/ml/yolo_roi",
                "/api/ml/aadhaar_fields",
                "/api/ml/face_match",
                "/api/ml/detect_image",
            ],
        }

    with gr.Blocks(title="No-Cap ML Microservice") as demo:
        gr.Markdown("# 🛡️ No-Cap AI/ML Microservice")
        gr.Markdown(
            "Active computer vision & deep learning backend for the **SSB Border Screening Desk (SIH26188)** connected to Vercel."
        )
        status_box = gr.JSON(value=get_status, label="Service Telemetry")
        refresh_btn = gr.Button("🔄 Refresh Status")
        refresh_btn.click(fn=get_status, outputs=status_box)

    app = gr.mount_gradio_app(fastapi_app, demo, path="/")
except ImportError:
    app = fastapi_app

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port)
