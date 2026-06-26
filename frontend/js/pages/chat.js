let chatSessionId = null;

export function renderChat(container, ctx) {
  container.innerHTML = `
    <div class="chat-container animate-slide-up">
      <div class="chat-messages" id="chatMessages">
        <div class="empty-state" id="chatEmpty">
          <h3>Start a Conversation</h3>
          <p>Connect to your AI provider and start chatting. All messages share memory within a session.</p>
          <button class="btn btn-primary btn-lg" id="chatStartBtn" style="margin-top:20px">
            Start Chat Session
          </button>
        </div>
      </div>
      <div class="chat-input-area" id="chatInputArea" style="display:none">
        <input type="text" class="input" id="chatInput" placeholder="Type your message..." autocomplete="off">
        <button class="btn btn-primary" id="chatSendBtn">Send</button>
        <button class="btn btn-ghost btn-sm" id="chatCloseBtn" title="End session">✕</button>
      </div>
    </div>
  `;

  const messages = document.getElementById('chatMessages');
  const inputArea = document.getElementById('chatInputArea');
  const input = document.getElementById('chatInput');

  function addBubble(text, type, provider) {
    const empty = document.getElementById('chatEmpty');
    if (empty) empty.remove();
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${type}`;
    if (type === 'ai' && provider) {
      bubble.innerHTML = `<span class="provider-tag">${provider}</span>${escapeHtml(text)}`;
    } else {
      bubble.textContent = text;
    }
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function showTyping() {
    const el = document.createElement('div');
    el.className = 'typing-indicator';
    el.id = 'typingIndicator';
    el.innerHTML = '<span></span><span></span><span></span>';
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  function hideTyping() {
    document.getElementById('typingIndicator')?.remove();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Start session
  document.getElementById('chatStartBtn').addEventListener('click', async () => {
    const btn = document.getElementById('chatStartBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Connecting...';

    try {
      const data = await ctx.API.post('/chat/start');
      if (data.error) throw new Error(data.error);
      chatSessionId = data.sessionId;
      document.getElementById('chatEmpty')?.remove();
      inputArea.style.display = 'flex';
      input.focus();
      addBubble(`Connected to ${data.provider}. Start chatting!`, 'ai', data.provider);
      ctx.showToast(`Chat started with ${data.provider}`, 'success');
    } catch (err) {
      ctx.showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Start Chat Session';
    }
  });

  // Send message
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || !chatSessionId) return;
    input.value = '';
    addBubble(text, 'user');
    showTyping();
    input.disabled = true;

    try {
      const data = await ctx.API.post('/chat/send', { sessionId: chatSessionId, message: text });
      hideTyping();
      if (data.error) throw new Error(data.error);
      addBubble(data.response, 'ai', data.provider);
    } catch (err) {
      hideTyping();
      addBubble(`Error: ${err.message}`, 'ai');
      ctx.showToast(err.message, 'error');
    }
    input.disabled = false;
    input.focus();
  }

  document.getElementById('chatSendBtn').addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

  // Close session
  document.getElementById('chatCloseBtn').addEventListener('click', async () => {
    if (chatSessionId) {
      await ctx.API.post('/chat/close', { sessionId: chatSessionId });
      chatSessionId = null;
    }
    inputArea.style.display = 'none';
    messages.innerHTML = `
      <div class="empty-state" id="chatEmpty">
        <h3>Session Ended</h3>
        <p>Start a new chat session to continue.</p>
        <button class="btn btn-primary btn-lg" id="chatStartBtn" style="margin-top:20px">Start Chat Session</button>
      </div>`;
    // Re-attach start listener
    document.getElementById('chatStartBtn')?.addEventListener('click', () => renderChat(container, ctx));
    ctx.showToast('Chat session closed', 'info');
  });

  // Socket.IO real-time events
  if (ctx.socket) {
    ctx.socket.off('chat:thinking');
    ctx.socket.on('chat:thinking', () => showTyping());
  }
}
