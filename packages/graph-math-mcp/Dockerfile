FROM python:3.11-slim

# Install Python dependencies
RUN pip install --no-cache-dir \
    networkx \
    mcp

# Copy server script
COPY server.py /app/server.py
RUN chmod 644 /app/server.py

WORKDIR /app

# Run MCP server
ENTRYPOINT ["python", "server.py"]
