import fs from 'fs';
import path from 'path';

import { DOMAIN_SKILLS_DIR as SKILL_DIR } from '../config.js';

function safeHost(hostname) {
  return String(hostname || 'unknown').toLowerCase().replace(/[^a-z0-9.-]/g, '_');
}

export function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

export function loadDomainSkill(url) {
  const hostname = safeHost(hostnameFromUrl(url));
  const file = path.join(SKILL_DIR, `${hostname}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function saveDomainSkill(url, history = [], research = null) {
  const hostname = safeHost(hostnameFromUrl(url));
  fs.mkdirSync(SKILL_DIR, { recursive: true });
  const file = path.join(SKILL_DIR, `${hostname}.json`);
  if (fs.existsSync(file)) return null;

  const actions = history
    .filter(h => h.tool && h.tool !== 'read' && h.tool !== 'wait' && h.tool !== 'screenshot')
    .map(h => ({ tool: h.tool, args: h.args, result: h.result }))
    .slice(0, 80);

  const serialized = JSON.stringify(actions).toLowerCase();
  const quirks = [];
  if (/role.*combobox|custom|aria/.test(serialized)) quirks.push('custom_dropdown_handling');
  if (/canvas|signature/.test(serialized)) quirks.push('canvas_signature_pad');
  if (/\+|-|counter|increment|decrement/.test(serialized)) quirks.push('counter_widget_clicks');

  const skill = {
    hostname,
    learnedAt: new Date().toISOString(),
    company: research?.companyName || null,
    role: research?.jobTitle || null,
    strategy: actions,
    quirks
  };
  fs.writeFileSync(file, JSON.stringify(skill, null, 2));
  return file;
}
