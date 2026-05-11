require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/react-code', (req, res) => {
  res.json({
    files: {
      "index.html": {
        file: {
          contents: "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.jsx\"></script></body></html>"
        }
      },
      "src/index.css": {
        file: {
          contents: "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Poppins:wght@300;400;500;600;700&display=swap');\n\n:root {\n  scroll-behavior: smooth;\n}\n\n.reveal { opacity: 0; transform: translateY(40px); transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1); }\n.reveal.active { opacity: 1; transform: translateY(0); }\n.reveal-left { opacity: 0; transform: translateX(-60px); transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1); }\n.reveal-left.active { opacity: 1; transform: translateX(0); }\n.reveal-right { opacity: 0; transform: translateX(60px); transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1); }\n.reveal-right.active { opacity: 1; transform: translateX(0); }\n@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }\n.float { animation: float 3s ease-in-out infinite; }\n@keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }\n.hero-animate { animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }\n.hero-animate-delay-1 { animation: slideUp 0.8s 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity: 0; }\n.hero-animate-delay-2 { animation: slideUp 0.8s 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity: 0; }\n@keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }\n.gradient-animate { background-size: 400% 400%; animation: gradientShift 8s ease infinite; }"
        }
      },
      "src/main.jsx": {
        file: {
          contents: "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport { Provider } from 'react-redux';\nimport { store } from './store';\nimport App from './App';\nimport './index.css';\n\nReactDOM.createRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    <Provider store={store}>\n      <App />\n    </Provider>\n  </React.StrictMode>\n);"
        }
      },
      "src/store/index.js": {
        file: {
          contents: "import { configureStore } from '@reduxjs/toolkit';\n// Import slices here\n\nexport const store = configureStore({\n  reducer: {\n    // Add reducers here\n  },\n});"
        }
      },
      "src/App.jsx": {
        file: {
          contents: "import React from 'react';\nimport { HashRouter, Routes, Route } from 'react-router-dom';\nimport Navbar from './components/Navbar';\nimport Hero from './components/Hero';\n// ...\n\nconst App = () => (\n  <div className=\"min-h-screen\">\n    <Navbar />\n    <Hero />\n    {/* ... */}\n  </div>\n);\n\nexport default App;"
        }
      },
      "src/components/Navbar.jsx": {
        file: {
          contents: "import React from 'react';\n// ...\nconst Navbar = () => {\n  return (<nav>...</nav>);\n};\nexport default Navbar;"
        }
      },
      "src/components/Hero.jsx": {
        file: {
          contents: "import React from 'react';\n// ...\nconst Hero = () => {\n  return (<section>...</section>);\n};\nexport default Hero;"
        }
      }
    }
  });
});

app.get('/next-code', async (req, res) => {
  const userName = req.query.name || 'Harshit';
  
  try {
    const jsonPath = path.join(__dirname, '../new-next-js-json.json');
    const content = await fs.readFile(jsonPath, 'utf8');
    const files = JSON.parse(content);

    // Dynamic Injection: Personalize the layout title
    if (files['app/layout.js']) {
      const layout = files['app/layout.js'].file.contents;
      files['app/layout.js'].file.contents = layout.replace(
        "title: 'AlignWell Chiropractic Clinic'",
        `title: 'AlignWell Chiropractic Clinic | Welcome, ${userName}!'`
      );
    }

    // Dynamic Injection: Personalize the practitioner name
    if (files['app/components/PractitionerPreview.js']) {
      const practitioner = files['app/components/PractitionerPreview.js'].file.contents;
      files['app/components/PractitionerPreview.js'].file.contents = practitioner.replace(
        /Dr\. Maya Thompson/g,
        `Dr. ${userName}`
      );
    }

    // Dynamic Injection: Personalize the Hero heading
    if (files['app/components/Hero.js']) {
      const hero = files['app/components/Hero.js'].file.contents;
      files['app/components/Hero.js'].file.contents = hero.replace(
        "built around you.",
        `built around you by ${userName}.`
      );
    }

    res.json({ files });
  } catch (err) {
    console.error('[Backend] Error loading project structure:', err);
    res.status(500).json({ error: 'Failed to generate project structure' });
  }
});

app.get('/healthcheck', (req, res) => {
  res.json({
    message: 'All good'
  })
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
