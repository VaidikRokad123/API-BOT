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
      if (sessionId) ctx.API.post('/chat/close', { sessionId }).catch(() => {});
    };
  }, [sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  useEffect(() => {
    if (!ctx.socket) return;
    const handleThinking = (data) => { if (data.sessionId === sessionId) setTyping(true); };
    const handleResponse = (data) => {
      if (data.sessionId === sessionId) {
        setTyping(false);
        setMessages(prev => {
          if (prev.some(m => m.text === data.message && m.type === 'ai')) return prev;
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
  }, [ctx.socket, sessionId]);

  const handleStartSession = async () => {
    setLoading(true);
    try {
      const data = await ctx.API.post('/chat/start');
      if (data.error) {
        const msg = typeof data.error === 'object' ? (data.error.message || JSON.stringify(data.error)) : data.error;
        throw new Error(msg);
      }
      setSessionId(data.sessionId);
      setMessages([{ text: `Connected to ${data.provider}. What would you like to discuss?`, type: 'ai', provider: data.provider }]);
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
        if (prev.some(m => m.text === data.response && m.type === 'ai')) return prev;
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
    setSessionId(null);
    setMessages([]);
    ctx.showToast('Chat session closed', 'info');
  };

  return (
    <div className="chat-container animate-slide-up">
      <div className="chat-messages">
        {sessionId === null ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <h3>Start a conversation</h3>
            <p>Opens a session with your active AI provider. Messages share context within the session.</p>
            <button type="button" className="btn btn-primary btn-lg" onClick={handleStartSession} disabled={loading}>
              {loading ? <><span className="spinner" /> Connecting...</> : 'Start chat session'}
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
              <div className="typing-indicator"><span /><span /><span /></div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {sessionId !== null && (
        <div className="chat-input-area">
          <input
            type="text"
            className="input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
            placeholder="Type your message…"
            autoComplete="off"
            disabled={inputDisabled}
          />
          <button type="button" className="btn btn-primary" onClick={handleSendMessage} disabled={inputDisabled}>
            Send
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleCloseSession} title="End session">
            End
          </button>
        </div>
      )}
    </div>
  );
}
