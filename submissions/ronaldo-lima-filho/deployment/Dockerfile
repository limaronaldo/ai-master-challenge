FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY solution/app.py solution/revops.py solution/jev.py solution/jev_guard.py solution/jev_budget.py ./
COPY solution/index.html solution/workflow.js ./
COPY solution/data ./data
COPY solution/assets ./assets
COPY deployment/demo_server.py ./demo_server.py
USER 10001:10001
EXPOSE 8080
CMD ["python3", "-B", "demo_server.py"]
