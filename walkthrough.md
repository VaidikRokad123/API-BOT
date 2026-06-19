# Walkthrough: Headless ChatGPT Web Automation Controller

We have built a fully functional MERN integration designed to bridge your web application with ChatGPT running **completely in the background (headless)**. It uses **Playwright** to run a hidden Chromium browser on your PC, utilizing your logged-in cookies to send prompts and retrieve responses without any popping GUI window.

---

## 🛠️ Components Implemented

### 1. Root & Orchestration
- [package.json](file:///d:/pro/gpt_auth/package.json): Root configuration modified to install all dependencies and manage background session log-ins.

### 2. Express Backend Server
- [backend/package.json](file:///d:/pro/gpt_auth/backend/package.json): Now includes `playwright` dependencies and script configurations.
- [backend/server.js](file:///d:/pro/gpt_auth/backend/server.js): Modified to directly call the Playwright automation module for incoming requests, saving history in MongoDB.

### 3. Playwright Headless Automation
- [backend/scripts/chatgpt_headless.js](file:///d:/pro/gpt_auth/backend/scripts/chatgpt_headless.js): The automation module:
  - **Login Mode**: Launches a visible browser for you to log in, then saves your authentication cookies into a local file `session.json` on your `D:` drive.
  - **Query Mode**: Loads `session.json`, launches a hidden background browser, navigates to `https://chatgpt.com`, pastes your prompt, waits for typing to finish, and extracts the response.

### 4. Glassmorphic React Frontend
- [frontend/src/App.jsx](file:///d:/pro/gpt_auth/frontend/src/App.jsx): Live console displaying connection status, processing animations, and managing text history logs.
- [frontend/src/index.css](file:///d:/pro/gpt_auth/frontend/src/index.css): Styling using glassmorphism, responsive chat bubbles, scrollbars, and neon-glow details.

---

## 🚀 Setup & Launch Instructions

Because your `C:` drive has a disk-space issue (`0x80070070`), **you must run these commands on your host terminal.** We will direct Playwright and NPM to store everything on your spacious `D:` drive!

### Step 1: Set Up Local Project Cache Directories (.cache)
Run these commands in your PowerShell console to create a local `.cache` folder in your project and redirect your temporary directories and Playwright browser downloads there:
```powershell
# Go to the root directory
cd D:\pro\gpt_auth

# Create local cache folders inside the project directory
New-Item -ItemType Directory -Force -Path ".cache\temp", ".cache\npm-cache", ".cache\playwright-browsers"

# Redirect environment variables to the local folders for this session
$env:TEMP="$PWD\.cache\temp"
$env:TMP="$PWD\.cache\temp"
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\.cache\playwright-browsers"
```

### Step 2: Install Node Dependencies
Install all backend and frontend packages:
```powershell
npm run install:all
```

### Step 3: Download the Playwright Browser to your D: Drive
Install Playwright's Chromium browser binary directly onto the `D:` drive:
```powershell
cd backend
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\..\.cache\playwright-browsers"
npx playwright install chromium
cd ..
```

### Step 4: Perform One-Time Login
Now, run the setup to authenticate with ChatGPT:
```powershell
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\.cache\playwright-browsers"
npm run login
```
A visible browser window will open. Go ahead and **log in to your ChatGPT account**. Once logged in and you see the chat text area, wait a couple of seconds. The terminal will print `[Setup] Success! Session saved` and close the browser.

---

## 💻 Running the Web App
From the root directory (`D:\pro\gpt_auth`), execute:
```powershell
$env:PLAYWRIGHT_BROWSERS_PATH="$PWD\.cache\playwright-browsers"
npm run dev
```

This launches:
- **Backend Node Server** on `http://localhost:5000`
- **Vite React Frontend** on `http://localhost:3000`

Open `http://localhost:3000` in your web browser. Type a message and hit Send! You will see status updates like:
1. `Focusing ChatGPT...`
2. `GPT is typing...`
3. The response will render on your UI while the browser runs completely hidden in the background!
