#!/bin/bash

# Configuration
ORCHESTRATOR_URL="http://localhost:3001/api/preview/start"
BACKEND_URL="http://localhost:3000/next-code"
COUNT=15

echo "🚀 Starting load test: Creating $COUNT preview pods..."

# 1. Fetch template files from backend
echo "📦 Fetching template code from backend..."
FILES=$(curl -s $BACKEND_URL)

if [ -z "$FILES" ]; then
    echo "❌ Error: Could not fetch files from backend. Is it running on port 3000?"
    exit 1
fi

echo "✅ Files fetched. Starting pod creation loop..."
echo "------------------------------------------------"

for i in $(seq 1 $COUNT); do
    PROJECT_ID="load-test-$i-$(date +%s)"
    USER_ID="tester-$i"
    
    echo "[$i/$COUNT] Creating pod for $PROJECT_ID..."
    
    # Send request to orchestrator
    RESPONSE=$(curl -s -X POST $ORCHESTRATOR_URL \
        -H "Content-Type: application/json" \
        -d "{
            \"projectId\": \"$PROJECT_ID\",
            \"userId\": \"$USER_ID\",
            \"files\": $FILES
        }")
    
    if echo "$RESPONSE" | grep -q "workerId"; then
        WORKER_ID=$(echo "$RESPONSE" | grep -o '"workerId":"[^"]*' | cut -d'"' -f4)
        echo "   ✅ Success: $WORKER_ID"
    else
        ERROR=$(echo "$RESPONSE" | grep -o '"error":"[^"]*' | cut -d'"' -f4)
        echo "   ❌ Failed: $ERROR"
    fi
    
    # Optional: Small sleep to prevent local rate limits
    sleep 0.5
done

echo "------------------------------------------------"
echo "🎉 Load test complete! Check your Grafana dashboard."
