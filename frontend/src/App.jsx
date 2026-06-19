import React, { useState, useEffect, useRef } from 'react';

function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [status, setStatus] = useState('ready'); // 'ready' | 'busy' | 'error'
  const [statusMessage, setStatusMessage] = useState('System Ready');
  const messagesEndRef = useRef(null);

  // Fetch chat history from DB on load
  const fetchHistory = async () => {
    try {
      const response = await fetch('/api/messages');
      if (response.ok) {
        const data = await response.json();
        setMessages(data);
        setStatus('ready');
        setStatusMessage('System Ready');
      } else {
        throw new Error('Could not load history');
      }
    } catch (error) {
      console.error(error);
      setStatus('error');
      setStatusMessage('Backend Disconnected');
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  // Auto scroll to bottom when messages list changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || status === 'busy') return;

    const userText = inputText;
    setInputText('');

    // Optimistically add user message to list
    const tempUserMsg = {
      _id: Date.now().toString(),
      text: userText,
      sender: 'user',
      timestamp: new Date().toISOString(),
      status: 'success'
    };
    
    setMessages(prev => [...prev, tempUserMsg]);
    setStatus('busy');
    setStatusMessage('Focusing GPT Desktop app & pasting prompt...');

    try {
      // Small timeout simulation for UI text updates
      setTimeout(() => {
        if (status === 'busy') {
          setStatusMessage('GPT is typing... Waiting for response completion...');
        }
      }, 2500);

      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: userText })
      });

      const data = await response.json();

      if (response.ok) {
        // Replace history with database-saved structures or append
        setMessages(prev => {
          // Remove the temporary message and append verified ones
          const filtered = prev.filter(m => m._id !== tempUserMsg._id);
          return [...filtered, data.userMessage, data.gptResponse];
        });
        setStatus('ready');
        setStatusMessage('Response received successfully');
      } else {
        // Appending the failed GPT message
        if (data.gptResponse) {
          setMessages(prev => {
            const filtered = prev.filter(m => m._id !== tempUserMsg._id);
            return [...filtered, data.userMessage, data.gptResponse];
          });
        }
        setStatus('error');
        setStatusMessage(data.details || data.error || 'Automation script encountered an error');
      }
    } catch (error) {
      console.error(error);
      setStatus('error');
      setStatusMessage('Request failed. Check backend console.');
    }
  };

  const handleClearHistory = async () => {
    if (!confirm('Are you sure you want to clear the entire chat history?')) return;
    
    try {
      const response = await fetch('/api/messages', { method: 'DELETE' });
      if (response.ok) {
        setMessages([]);
        setStatus('ready');
        setStatusMessage('History cleared');
      } else {
        throw new Error('Failed to delete history');
      }
    } catch (error) {
      console.error(error);
      setStatus('error');
      setStatusMessage('Failed to clear database logs.');
    }
  };

  // Utility to format date timestamps
  const formatTime = (isoString) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return '';
    }
  };

  return (
    <div className="app-container">
      {/* Header Panel */}
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🤖</span>
          <div>
            <h1>GPT Desktop Automation</h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>Local Client Bridge</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {messages.length > 0 && (
            <button className="clear-button" onClick={handleClearHistory}>
              Clear Logs
            </button>
          )}
          
          <div className="status-badge">
            <span className={`status-dot ${status}`} />
            <span>{statusMessage}</span>
          </div>
        </div>
      </header>

      {/* Main Conversation Window */}
      <main className="chat-window">
        {messages.length === 0 ? (
          <div className="welcome-screen">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <line x1="9" y1="3" x2="9" y2="21"/>
              <line x1="15" y1="3" x2="15" y2="21"/>
              <line x1="3" y1="9" x2="21" y2="9"/>
              <line x1="3" y1="15" x2="21" y2="15"/>
            </svg>
            <h2>Automation Console Ready</h2>
            <p>
              Type a prompt below. The local server will automatically focus your 
              PC's GPT desktop app, submit it, wait for completion, and return the response.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg._id} className={`message-row ${msg.sender} ${msg.status === 'failed' ? 'failed' : ''}`}>
              <div className="message-bubble">
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                <span className="message-time">{formatTime(msg.timestamp)}</span>
              </div>
            </div>
          ))
        )}

        {status === 'busy' && (
          <div className="message-row gpt">
            <div className="message-bubble" style={{ background: 'transparent', borderColor: 'transparent' }}>
              <div className="typing-indicator">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Form Panel */}
      <footer className="input-panel">
        <form onSubmit={handleSubmit} className="input-form">
          <input
            type="text"
            className="input-field"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={status === 'busy' ? 'Waiting for automation script...' : 'Ask your desktop ChatGPT...'}
            disabled={status === 'busy'}
            autoFocus
          />
          <button type="submit" className="send-button" disabled={status === 'busy' || !inputText.trim()}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </form>
      </footer>
    </div>
  );
}

export default App;
