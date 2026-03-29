FROM python:3.11-slim

# Install graphviz (required by diagrams library)
RUN apt-get update && apt-get install -y --no-install-recommends \
    graphviz \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip install --no-cache-dir \
    diagrams \
    mcp

# Copy server script
COPY server.py /app/server.py
RUN chmod 644 /app/server.py

WORKDIR /app

# Run MCP server
ENTRYPOINT ["python", "server.py"]
