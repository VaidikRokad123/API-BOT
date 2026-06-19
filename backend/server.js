import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { connectDB } from './config/db.js';
import Message from './models/Message.js';
import { askChatGPT } from './scripts/chatgpt_headless.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Resolve directories
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middlewares
app.use(cors());
app.use(express.json());

// Connect Database
connectDB();

// API: Get message history
app.get('/api/messages', async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve message history.' });
  }
});

// API: Send message to ChatGPT Headless Browser and get response
app.post('/api/messages', async (req, res) => {
  const { text } = req.body;

  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Message content is required.' });
  }

  try {
    // 1. Save user message to database
    const userMessage = new Message({
      text: text,
      sender: 'user',
      status: 'success'
    });
    await userMessage.save();

    console.log(`[Backend] Querying ChatGPT Headless Browser: "${text.substring(0, 30)}..."`);

    // 2. Query Playwright headless browser
    const responseText = await askChatGPT(text);

    // 3. Save GPT response to database
    const gptMessage = new Message({
      text: responseText,
      sender: 'gpt',
      status: 'success'
    });
    await gptMessage.save();

    // 4. Return to React UI
    res.json({
      userMessage: userMessage,
      gptResponse: gptMessage
    });

  } catch (error) {
    console.error(`[Backend] Automation failed: ${error.message}`);
    
    // Save failed status for the response
    const failedResponse = new Message({
      text: `Automation Error: ${error.message || 'Failed to interact with ChatGPT.'}`,
      sender: 'gpt',
      status: 'failed',
      error: error.message
    });
    await failedResponse.save();

    res.status(500).json({
      error: 'Automation failed.',
      details: error.message,
      userMessage: userMessage,
      gptResponse: failedResponse
    });
  }
});

// API: Clear database history
app.delete('/api/messages', async (req, res) => {
  try {
    await Message.deleteMany({});
    res.json({ message: 'History cleared successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear history.' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running in development mode on port ${PORT}`);
});
