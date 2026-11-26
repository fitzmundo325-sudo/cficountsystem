FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p instance uploads

EXPOSE 5002

CMD ["gunicorn", "-b", "0.0.0.0:5002", "-w", "4", "--threads", "8", "--timeout", "320", "app:app"]
