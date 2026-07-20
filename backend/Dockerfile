#syntax=docker/dockerfile:1

FROM node:20.19.0-slim

# Install LibreOffice for DOC/DOCX/PPTX to PDF conversion.
# Install tesseract-ocr + poppler-utils for OCR fallback on scanned PDFs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     libreoffice-writer \
     libreoffice-calc \
     libreoffice-impress \
     fonts-dejavu \
     tesseract-ocr \
     tesseract-ocr-eng \
     tesseract-ocr-por \
     poppler-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Run as non-root.
RUN groupadd -r mike && useradd -r -g mike -d /app -s /sbin/nologin mike \
  && chown -R mike:mike /app

USER mike

EXPOSE 3001

CMD ["npm", "run", "dev"]
