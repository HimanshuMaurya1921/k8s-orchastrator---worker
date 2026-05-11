const fetch = require('node-fetch');

const ORCHESTRATOR_URL = 'http://localhost:3001/api/preview/start';
const BACKEND_URL = 'http://localhost:3000/next-code';
const CONCURRENCY = 15;

async function runTest() {
  console.log(`🚀 Starting load test: Creating ${CONCURRENCY} preview pods...`);

  // 1. Get the template code from backend
  console.log('📦 Fetching template code from backend...');
  const codeRes = await fetch(BACKEND_URL);
  const files = await codeRes.json();

  const startTime = Date.now();
  const promises = [];

  for (let i = 1; i <= CONCURRENCY; i++) {
    const projectId = `load-test-${i}-${Date.now()}`;
    const userId = `tester-${i}`;

    console.log(`[${i}/${CONCURRENCY}] Requesting pod for ${projectId}...`);
    
    const promise = fetch(ORCHESTRATOR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, userId, files })
    })
    .then(async (res) => {
      const data = await res.json();
      if (res.ok) {
        console.log(`✅ Pod created: ${data.workerId}`);
        return data;
      } else {
        console.error(`❌ Failed: ${data.error}`);
        return null;
      }
    })
    .catch(err => {
      console.error(`❌ Network Error: ${err.message}`);
      return null;
    });

    promises.push(promise);
    
    // Add a small delay between requests to avoid overwhelming the K8s API
    await new Promise(r => setTimeout(r, 500));
  }

  const results = await Promise.all(promises);
  const successful = results.filter(Boolean).length;
  
  console.log('\n--- Test Summary ---');
  console.log(`Total Requests: ${CONCURRENCY}`);
  console.log(`Successful:     ${successful}`);
  console.log(`Failed:         ${CONCURRENCY - successful}`);
  console.log(`Total Time:     ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
  console.log('--------------------\n');
  
  console.log('Check your Grafana dashboard to see the CPU/Memory spike!');
}

runTest().catch(console.error);
