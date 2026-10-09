FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    DATABASE_PATH=/data/flowq.sqlite3 \
    UPLOAD_DIR=/data/media \
    ALLOWED_ORIGINS=http://localhost:5173

WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt \
    && useradd --uid 10001 --create-home flowq \
    && mkdir -p /data/media \
    && chown -R flowq:flowq /data

COPY backend/*.py /app/backend/
COPY backend/tools/*.py /app/backend/tools/
COPY industry_packs/ /app/industry_packs/

USER flowq
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8000')+'/api/health',timeout=4)"
CMD ["python", "-m", "backend"]
