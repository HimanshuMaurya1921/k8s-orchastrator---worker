#!/bin/bash

# Configuration
ORCHESTRATOR_URL="http://localhost:3001/api/preview/start"
BACKEND_URL="http://localhost:3000/next-code"
NUM_PODS=15
REQUESTS_PER_POD=50

echo "🔥 STARTING STRESS TEST 🔥"
echo "Target: $NUM_PODS pods x $REQUESTS_PER_POD requests = $((NUM_PODS * REQUESTS_PER_POD)) total requests"

# 1. Fetch template files
echo "📦 Fetching template code..."
FILES=$(curl -s $BACKEND_URL)
if [ -z "$FILES" ]; then
    echo "❌ Error: Backend not reachable on port 3000"
    exit 1
fi

# 2. Create pods
WORKER_IDS=()
echo "🏗 Creating $NUM_PODS pods..."
for i in $(seq 1 $NUM_PODS); do
    PROJECT_ID="stress-test-$i-$(date +%s)"
    RESPONSE=$(curl -s -X POST $ORCHESTRATOR_URL \
        -H "Content-Type: application/json" \
        -d "{\"projectId\": \"$PROJECT_ID\", \"userId\": \"user-$i\", \"files\": $FILES}")
    
    if echo "$RESPONSE" | grep -q "workerId"; then
        WORKER_ID=$(echo "$RESPONSE" | grep -o '"workerId":"[^"]*' | cut -d'"' -f4)
        WORKER_IDS+=("$WORKER_ID")
        echo "   ✅ Created: $WORKER_ID"
    else
        echo "   ❌ Failed to create pod $i"
    fi
    sleep 0.5
done

echo "------------------------------------------------"
echo "⏳ Waiting 10 seconds for all Next.js servers to warm up..."
sleep 10

# 3. Stress Test Loop
echo "⚡ Blasting each pod with $REQUESTS_PER_POD requests..."

# Function to stress a single worker
stress_worker() {
    local wid=$1
    local reqs=$2
    local count=0
    for j in $(seq 1 $reqs); do
        # Hit a known Next.js page or API route
        # Using -o /dev/null to ignore body, -s for silent
        curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/preview/proxy/$wid/" &
        count=$((count + 1))
        
        # Throttling slightly to not overwhelm local socket limits
        if (( count % 10 == 0 )); then wait; fi
    done
    wait
    echo "   🏁 Finished stressing $wid"
}

# Export the function for background execution
export -f stress_worker

START_TIME=$(date +%s)

# Launch stress tasks for all workers in parallel
for wid in "${WORKER_IDS[@]}"; do
    stress_worker "$wid" "$REQUESTS_PER_POD" &
done

wait # Wait for all background stress tasks to finish

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "------------------------------------------------"
echo "✅ STRESS TEST COMPLETE"
echo "⏱ Total Stress Duration: ${DURATION}s"
echo "📈 Check Grafana for CPU/Memory spikes and Proxy Latency!"
echo "🚀 Orchestrator logs: kubectl logs -l app=orchestrator -n preview --tail=100"
