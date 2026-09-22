FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for OpenCV and network tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and models
COPY . .

# Expose standard port for documentation
EXPOSE 7860

# Universal runner: binds to $PORT if provided (Render, Railway, Cloud Run),
# or defaults to 7860 (Hugging Face Spaces, local Docker)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860}"]
