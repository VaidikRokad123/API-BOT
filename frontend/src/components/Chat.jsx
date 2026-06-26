import React, { useState, useEffect, useRef } from 'react';

export default function Chat({ ctx }) {
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [typing, setTyping] = useState(false);
  const [inputDisabled, setInputDisabled] = useState(false);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    return () => {
      if (sessionId) {
        console.log('[Chat Teardown] Closing session:', sessionId);
        ctx.API.post('/chat/close', { sessionId }).catch((e) => {
          console.error('[Chat Teardown] Close request failed:', e);
        });
      }
    };
  }, [sessionId]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, typing]);

  useEffect(() => {
    if (ctx.socket) {
      const handleThinking = (data) => {
        if (data.sessionId === sessionId) setTyping(true);
      };
      const handleResponse = (data) => {
        if (data.sessionId === sessionId) {
          setTyping(false);
          // Only add bubble if not already added by API response (backup)
          setMessages(prev => {
            const exists = prev.some(m => m.text === data.message && m.type === 'ai');
            if (exists) return prev;
            return [...prev, { text: data.message, type: 'ai', provider: data.provider }];
          });
        }
      };

      ctx.socket.on('chat:thinking', handleThinking);
      ctx.socket.on('chat:response', handleResponse);

      return () => {
        ctx.socket.off('chat:thinking', handleThinking);
        ctx.socket.off('chat:response', handleResponse);
      };
    }
  }, [ctx.socket, sessionId]);

  const handleStartSession = async () => {
    setLoading(true);
    try {
      const data = await ctx.API.post('/chat/start');
      if (data.error) throw new Error(data.error);
      setSessionId(data.sessionId);
      setMessages([{ text: `Connected to ${data.provider}. Start chatting!`, type: 'ai', provider: data.provider }]);
      ctx.showToast(`Chat started with ${data.provider}`, 'success');
    } catch (err) {
      ctx.showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || !sessionId) return;
    setInputText('');
    setMessages(prev => [...prev, { text, type: 'user' }]);
    setTyping(true);
    setInputDisabled(true);

    try {
      const data = await ctx.API.post('/chat/send', { sessionId, message: text });
      setTyping(false);
      if (data.error) throw new Error(data.error);
      setMessages(prev => {
        // Prevent duplicate bubbles if Socket.IO also fired it
        const exists = prev.some(m => m.text === data.response && m.type === 'ai');
        if (exists) return prev;
        return [...prev, { text: data.response, type: 'ai', provider: data.provider }];
      });
    } catch (err) {
      setTyping(false);
      setMessages(prev => [...prev, { text: `Error: ${err.message}`, type: 'ai' }]);
      ctx.showToast(err.message, 'error');
    } finally {
      setInputDisabled(false);
    }
  };

  const handleCloseSession = () => {
    if (sessionId) {
      setSessionId(null);
      setMessages([]);
      ctx.showToast('Chat session closed', 'info');
    }
  };

  return (
    <div className="chat-container animate-slide-up">
      <div className="chat-messages" style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {sessionId === null ? (
          <div className="empty-state">
            <h3>Start a Conversation</h3>
            <p>Connect to your AI provider and start chatting. All messages share memory within a session.</p>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleStartSession}
              disabled={loading}
              style={{ marginTop: '20px' }}
            >
              {loading ? <><span className="spinner"></span> Connecting...</> : 'Start Chat Session'}
            </button>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble ${m.type}`}>
                {m.type === 'ai' && m.provider && <span className="provider-tag">{m.provider}</span>}
                {m.text}
              </div>
            ))}
            {typing && (
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {sessionId !== null && (
        <div className="chat-input-area" style={{ display: 'flex' }}>
          <input
            type="text"
            className="input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
            placeholder="Type your message..."
            autoComplete="off"
            disabled={inputDisabled}
          />
          <button className="btn btn-primary" onClick={handleSendMessage} disabled={inputDisabled}>
            Send
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleCloseSession} title="End session">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
