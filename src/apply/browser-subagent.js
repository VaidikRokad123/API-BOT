import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { z } from 'zod';

const PERMISSIONS_FILE = path.join(process.cwd(), 'data', 'permissions.json');
const DEFAULT_PERMISSIONS = {
  fill_text_field: 'allow',
  select_dropdown: 'allow',
  oauth_login: 'ask',
  submit_application: 'ask',
  upload_file: 'allow'
};

const TOOL_STATUS = z.enum(['continue', 'done', 'blocked']).default('continue');
const SELECTOR_ARGS_BASE = z.object({
  selector: z.string().optional(),
  ref: z.string().optional()
}).strict();
const SELECTOR_ARGS = SELECTOR_ARGS_BASE.refine(v => v.selector || v.ref, 'selector or ref is required');

export const ExecutionActionSchema = z.object({
  type: z.enum(['click', 'fill', 'select', 'check', 'upload', 'signature']),
  selector: z.string().optional(),
  ref: z.string().optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
  optionKind: z.enum(['native_select', 'custom_combobox', 'unknown']).optional(),
  category: z.enum(['fill_text_field', 'select_dropdown', 'oauth_login', 'submit_application', 'upload_file']).optional()
}).strict().refine(v => v.selector || v.ref || v.type === 'signature', 'selector or ref is required');

const FillFormActionSchema = ExecutionActionSchema.refine(
  action => ['fill', 'select', 'check', 'upload', 'signature'].includes(action.type),
  'fill_form actions may only fill/select/check/upload/signature'
);

const baseToolFields = {
  reasoning: z.string().default(''),
  status: TOOL_STATUS
};

export const AiActionSchema = z.discriminatedUnion('tool', [
  z.object({ ...baseToolFields, tool: z.literal('navigate'), args: z.object({ url: z.string().min(1) }).strict() }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('click'), args: SELECTOR_ARGS_BASE.extend({ category: z.enum(['submit_application', 'oauth_login']).optional() }).strict().refine(v => v.selector || v.ref, 'selector or ref is required') }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('click_blank'), args: z.object({ x: z.number().optional(), y: z.number().optional() }).strict().default({}) }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('fill'), args: SELECTOR_ARGS_BASE.extend({ value: z.union([z.string(), z.number(), z.boolean()]) }).strict().refine(v => v.selector || v.ref, 'selector or ref is required') }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('select'), args: SELECTOR_ARGS_BASE.extend({ value: z.union([z.string(), z.number(), z.boolean()]), optionKind: z.enum(['native_select', 'custom_combobox', 'unknown']).optional() }).strict().refine(v => v.selector || v.ref, 'selector or ref is required') }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('check'), args: SELECTOR_ARGS }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('upload'), args: SELECTOR_ARGS }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('scroll'), args: z.object({ direction: z.enum(['up', 'down']).optional(), selector: z.string().optional(), amount: z.number().optional() }).strict().default({}) }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('hover'), args: SELECTOR_ARGS }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('press'), args: z.object({ key: z.string().min(1) }).strict() }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('wait'), args: z.object({ ms: z.number().optional(), selector: z.string().optional() }).strict().default({}) }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('read'), args: z.object({}).strict().default({}) }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('screenshot'), args: z.object({ label: z.string().optional() }).strict().default({}) }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('extract'), args: z.object({ selector: z.string().optional(), ref: z.string().optional() }).strict().default({}) }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('handle_login'), args: z.object({}).strict().default({}) }).strict(),
  z.object({ ...baseToolFields, tool: z.literal('signature'), args: SELECTOR_ARGS }).strict(),
  z.object({
    ...baseToolFields,
    tool: z.literal('fill_form'),
    args: z.object({ actions: z.array(FillFormActionSchema).min(1) }).strict()
  }).strict(),
  z.object({
    ...baseToolFields,
    tool: z.literal('finish'),
    args: z.object({
      report: z.string().optional(),
      result: z.string().optional(),
      summary: z.string().optional(),
      answer: z.string().optional()
    }).strict().default({})
  }).strict()
]);

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function quote(value) {
  return `"${String(value || '').replace(/"/g, '\\"')}"`;
}

function pageUrl(page) {
  try {
    return typeof page.url === 'function' ? page.url() : '';
  } catch {
    return '';
  }
}

async function pageTitle(page) {
  try {
    return typeof page.title === 'function' ? await page.title() : '';
  } catch {
    return '';
  }
}

function loadPermissions() {
  try {
    if (!fs.existsSync(PERMISSIONS_FILE)) return DEFAULT_PERMISSIONS;
    const parsed = JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8'));
    return { ...DEFAULT_PERMISSIONS, ...parsed };
  } catch {
    return DEFAULT_PERMISSIONS;
  }
}

function normalizePermission(value) {
  return ['allow', 'ask', 'deny'].includes(value) ? value : 'ask';
}

function inferCategory(action) {
  if (action.category) return action.category;
  if (action.type === 'fill' || action.type === 'check' || action.type === 'signature') return 'fill_text_field';
  if (action.type === 'select') return 'select_dropdown';
  if (action.type === 'upload') return 'upload_file';
  if (action.type === 'click') {
    const haystack = `${action.description || ''} ${action.selector || ''} ${action.ref || ''}`;
    if (/\b(submit|submit application|apply|complete application|finish)\b/i.test(haystack)) return 'submit_application';
  }
  return null;
}

function terminalQuestion(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(/^y(?:es)?$/i.test(String(answer || '').trim()));
    });
  });
}

async function enforcePermission(page, action, ctx) {
  const category = inferCategory(action);
  if (!category) return;
  const policy = normalizePermission((ctx.permissions || loadPermissions())[category]);
  if (policy === 'allow') return;
  if (policy === 'deny') {
    throw new Error(`Permission policy denied ${category}`);
  }

  const screenshot = await ctx.run?.savePendingActionScreenshot?.(page, ctx.step || 0, action).catch(() => null);
  const pending = {
    category,
    action: action.type,
    selector: action.selector,
    ref: action.ref,
    value: action.value,
    screenshot
  };
  ctx.logger?.warn?.(pending, 'permission_ask');
  process.stdout.write(`\nPending ${category}: ${JSON.stringify(pending, null, 2)}\n`);
  if (screenshot) process.stdout.write(`Screenshot: ${screenshot}\n`);
  const approved = await terminalQuestion('Proceed with this action? y/N > ');
  if (!approved) throw new Error(`User rejected ${category}`);
}

export async function enforceActionPermission(page, action, ctx = {}) {
  return enforcePermission(page, validateExecutionAction({
    type: action.type || 'click',
    selector: action.selector || 'body',
    ref: action.ref,
    value: action.value,
    description: action.description,
    category: action.category
  }), ctx);
}

export function validateAiAction(raw) {
  const parsed = AiActionSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ');
    throw new Error(`AI action schema mismatch: ${message}`);
  }
  return parsed.data;
}

export function validateExecutionAction(raw) {
  const parsed = ExecutionActionSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map(issue => `${issue.path.join('.') || 'root'}: ${issue.message}`).join('; ');
    throw new Error(`Execution action schema mismatch: ${message}`);
  }
  return parsed.data;
}

async function getAriaSnapshot(page) {
  try {
    if (typeof page.ariaSnapshot === 'function') {
      return await page.ariaSnapshot({ mode: 'ai' });
    }
    if (typeof page.locator === 'function') {
      return await page.locator('body').ariaSnapshot({ mode: 'ai' });
    }
  } catch {
    try {
      if (typeof page.locator === 'function') return await page.locator('body').ariaSnapshot();
    } catch {
      return null;
    }
  }
  return null;
}

export async function perceive(page, consoleBuffer = null) {
  const ariaSnapshot = await getAriaSnapshot(page);
  const extracted = await page.evaluate(() => {
    let refSeq = 0;
    const interestingSelector = [
      'input', 'textarea', 'select', 'button', 'a[href]', 'canvas',
      '[role]', '[contenteditable="true"]', '[tabindex]', '[onclick]',
      'label[for]'
    ].join(',');
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const text = value => String(value || '').replace(/\s+/g, ' ').trim();
    const labelText = el => {
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const fromIds = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ');
        if (text(fromIds)) return text(fromIds);
      }
      if (el.labels?.length) {
        const labels = Array.from(el.labels).map(label => label.innerText).join(' ');
        if (text(labels)) return text(labels);
      }
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label && text(label.innerText)) return text(label.innerText);
      }
      const wrappingLabel = el.closest('label');
      if (wrappingLabel && text(wrappingLabel.innerText)) return text(wrappingLabel.innerText);
      return '';
    };
    const roleFor = el => {
      const explicit = el.getAttribute('role');
      if (explicit) return explicit;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
      if (tag === 'button') return 'button';
      if (tag === 'a') return 'link';
      if (tag === 'canvas') return 'canvas';
      if (tag === 'input') {
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'file') return 'button';
        if (type === 'range') return 'slider';
        return 'textbox';
      }
      if (el.isContentEditable) return 'textbox';
      return 'generic';
    };
    const accessibleName = el => {
      const name = text(
        el.getAttribute('aria-label') ||
        labelText(el) ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.innerText ||
        el.value ||
        el.getAttribute('name') ||
        el.id
      );
      return name || '(unnamed)';
    };
    const cssSelectorFor = ref => `[data-gpt-auth-ref="${ref}"]`;
    const optionList = select => Array.from(select.options || []).map(option => ({
      text: text(option.textContent),
      value: option.value,
      selected: option.selected,
      disabled: option.disabled
    }));
    const elements = [];
    for (const el of Array.from(document.querySelectorAll(interestingSelector))) {
      if (!visible(el)) continue;
      if (!el.dataset.gptAuthRef) {
        refSeq += 1;
        el.dataset.gptAuthRef = `gpt-ref-${refSeq}`;
      }
      const tag = el.tagName.toLowerCase();
      const role = roleFor(el);
      const type = (el.getAttribute('type') || tag).toLowerCase();
      const nativeSelect = tag === 'select';
      const customDropdown = !nativeSelect && (
        role === 'combobox' ||
        role === 'listbox' ||
        el.getAttribute('aria-haspopup') === 'listbox' ||
        el.getAttribute('aria-controls')
      );
      const value = nativeSelect
        ? text(el.selectedOptions?.[0]?.textContent || el.value)
        : (el.isContentEditable ? text(el.innerText) : text(el.value || el.getAttribute('aria-valuetext') || ''));
      elements.push({
        role,
        name: accessibleName(el),
        ref: el.dataset.gptAuthRef,
        selector: cssSelectorFor(el.dataset.gptAuthRef),
        tag,
        type,
        required: !!el.required || el.getAttribute('aria-required') === 'true',
        disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
        value,
        checked: type === 'checkbox' || type === 'radio' || role === 'checkbox' || role === 'radio'
          ? !!el.checked || el.getAttribute('aria-checked') === 'true'
          : undefined,
        selected: role === 'option' ? el.getAttribute('aria-selected') === 'true' || el.selected === true : undefined,
        placeholder: text(el.getAttribute('placeholder')),
        dropdownKind: nativeSelect ? 'native_select' : (customDropdown ? 'custom_combobox' : undefined),
        options: nativeSelect ? optionList(el) : []
      });
    }
    return {
      text: text(document.body?.innerText || '').slice(0, 16000),
      elements
    };
  }).catch(() => ({ text: '', elements: [] }));

  const elementList = renderElementList(extracted.elements);
  return {
    url: pageUrl(page),
    title: await pageTitle(page),
    pageText: extracted.text,
    ariaSnapshot: ariaSnapshot ? String(ariaSnapshot).slice(0, 8000) : null,
    elementList,
    elements: extracted.elements,
    fields: extracted.elements
      .filter(e => ['textbox', 'combobox', 'listbox', 'checkbox', 'radio', 'button', 'slider', 'canvas'].includes(e.role))
      .map(e => ({
        label: e.name,
        type: e.tag === 'select' ? 'select' : e.type,
        selector: e.selector,
        ref: e.ref,
        required: e.required,
        placeholder: e.placeholder,
        currentValue: e.value,
        checked: e.checked,
        options: e.options?.map(o => ({ text: o.text, value: o.value, selected: o.selected, disabled: o.disabled, isPlaceholder: !o.value && !o.text }))
      })),
    buttons: extracted.elements
      .filter(e => ['button', 'link'].includes(e.role) || e.type === 'submit' || e.type === 'button')
      .map(e => ({ text: e.name, selector: e.selector, ref: e.ref, disabled: e.disabled })),
    canvases: extracted.elements.filter(e => e.tag === 'canvas').map(e => ({ selector: e.selector, ref: e.ref, label: e.name })),
    checkboxGroups: {},
    consoleTail: consoleBuffer ? consoleBuffer.getBuffer() : []
  };
}

function renderElementList(elements = []) {
  return elements.map(e => {
    const parts = [
      `role=${e.role}`,
      `name=${quote(e.name)}`,
      `ref=${e.ref}`,
      `selector=${quote(e.selector)}`
    ];
    if (e.placeholder) parts.push(`placeholder=${quote(e.placeholder)}`);
    if (e.value) parts.push(`value=${quote(e.value)}`);
    if (typeof e.checked === 'boolean') parts.push(`checked=${e.checked}`);
    if (typeof e.selected === 'boolean') parts.push(`selected=${e.selected}`);
    if (e.dropdownKind) parts.push(`dropdown=${e.dropdownKind}`);
    if (e.options?.length) {
      parts.push(`options=[${e.options.map(o => `${o.selected ? '*' : ''}${o.text || o.value}`).join(' | ')}]`);
    }
    return `- ${parts.join(' | ')}`;
  }).join('\n');
}

async function findActionElement(page, action) {
  const selector = action.selector || (action.ref ? `[data-gpt-auth-ref="${String(action.ref).replace(/"/g, '\\"')}"]` : null);
  if (!selector) return null;
  return page.$(selector).catch(() => null);
}

async function elementInfo(page, el) {
  return page.evaluate(element => {
    const role = element.getAttribute('role') || '';
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || tag).toLowerCase();
    return {
      tag,
      type,
      role,
      disabled: !!element.disabled || element.getAttribute('aria-disabled') === 'true',
      isNativeSelect: tag === 'select',
      isCustomDropdown: tag !== 'select' && (
        role === 'combobox' ||
        role === 'listbox' ||
        element.getAttribute('aria-haspopup') === 'listbox' ||
        !!element.getAttribute('aria-controls')
      ),
      text: String(element.innerText || element.textContent || element.value || '').replace(/\s+/g, ' ').trim()
    };
  }, el);
}

async function focusAndType(page, el, value) {
  await page.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }), el).catch(() => {});
  await el.click().catch(async () => {
    const box = await el.boundingBox?.().catch(() => null);
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(String(value ?? ''), { delay: 1 });
}

async function nativeSelect(page, el, value) {
  const target = String(value ?? '').trim();
  const options = await page.evaluate(element => {
    return Array.from(element.options || []).map(o => ({
      text: String(o.textContent || '').replace(/\s+/g, ' ').trim(),
      value: o.value,
      disabled: o.disabled
    }));
  }, el);
  const normalize = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const option = options.find(o => !o.disabled && normalize(o.text) === normalize(target)) ||
    options.find(o => !o.disabled && normalize(o.value) === normalize(target)) ||
    options.find(o => !o.disabled && normalize(o.text).includes(normalize(target))) ||
    null;
  if (!option) throw new Error(`element_not_found: native select option "${target}"`);
  if (typeof el.select === 'function') await el.select(option.value);
  else if (typeof el.selectOption === 'function') await el.selectOption(option.value);
  else throw new Error('form_incompatible: native select handle cannot select options');
  return `Selected native option "${option.text}"`;
}

async function customSelect(page, el, value) {
  const target = cleanText(value);
  await page.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }), el).catch(() => {});
  await el.click();
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.type(target, { delay: 1 }).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 200));

  const optionRef = await page.evaluate(targetText => {
    const text = value => String(value || '').replace(/\s+/g, ' ').trim();
    const lower = text(targetText).toLowerCase();
    const visible = el => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
        style.visibility !== 'hidden' && style.opacity !== '0';
    };
    const options = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li, div, button'))
      .filter(el => visible(el) && text(el.innerText || el.textContent).toLowerCase());
    options.sort((a, b) => text(a.innerText).length - text(b.innerText).length);
    const match = options.find(el => text(el.innerText || el.textContent).toLowerCase() === lower) ||
      options.find(el => text(el.innerText || el.textContent).toLowerCase().includes(lower));
    if (!match) return null;
    if (!match.dataset.gptAuthRef) match.dataset.gptAuthRef = `gpt-ref-option-${Date.now()}`;
    return match.dataset.gptAuthRef;
  }, target);

  if (optionRef) {
    const option = await page.$(`[data-gpt-auth-ref="${optionRef}"]`);
    if (option) {
      await option.click();
      return `Selected custom option "${target}"`;
    }
  }
  await page.keyboard.press('Enter');
  return `Typed custom dropdown value "${target}" and pressed Enter`;
}

async function clickElement(page, el) {
  await page.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }), el).catch(() => {});
  try {
    await el.click();
  } catch {
    const box = await el.boundingBox?.().catch(() => null);
    if (!box) throw new Error('element_not_found: clickable element has no box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
}

async function readChoiceState(page, el) {
  return page.evaluate(element => !!element.checked || element.getAttribute('aria-checked') === 'true', el).catch(() => false);
}

async function uploadFile(page, el, filePath) {
  const isFile = await page.evaluate(element => element.tagName === 'INPUT' && (element.getAttribute('type') || '').toLowerCase() === 'file', el);
  if (isFile) {
    if (typeof el.uploadFile === 'function') await el.uploadFile(filePath);
    else if (typeof el.setInputFiles === 'function') await el.setInputFiles(filePath);
    else throw new Error('form_incompatible: file input does not support uploads');
    return `Uploaded ${path.basename(filePath)}`;
  }
  const chooserPromise = page.waitForFileChooser?.({ timeout: 8000 }).catch(() => null);
  await clickElement(page, el);
  const chooser = chooserPromise ? await chooserPromise : null;
  if (!chooser) throw new Error('timeout: file chooser did not open');
  await chooser.accept([filePath]);
  return `Uploaded ${path.basename(filePath)} through file chooser`;
}

async function drawSignature(page, el) {
  const box = await el.boundingBox?.();
  if (!box) throw new Error('element_not_found: signature canvas has no box');
  const cx = box.x + box.width * 0.15;
  const cy = box.y + box.height * 0.55;
  const w = box.width * 0.7;
  const h = box.height * 0.35;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const pts = [
    [0.00, 0.0], [0.08, -0.8], [0.16, -0.2], [0.23, 0.1],
    [0.30, -0.7], [0.39, -0.1], [0.48, 0.2], [0.58, -0.6],
    [0.70, -0.1], [0.82, 0.1], [0.92, -0.2], [1.00, 0.0]
  ];
  for (const [px, py] of pts) await page.mouse.move(cx + px * w, cy + py * h, { steps: 3 });
  await page.mouse.move(cx, cy + h * 0.5);
  await page.mouse.move(cx + w, cy + h * 0.5, { steps: 16 });
  await page.mouse.up();
  return 'Drew signature';
}

export async function waitForStable(page, { quietMs = 500, timeoutMs = 5000 } = {}) {
  return page.evaluate(({ quiet, cap }) => new Promise(resolve => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      observer.disconnect();
      resolve(true);
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(finish, quiet);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    schedule();
    setTimeout(finish, cap);
  }), { quiet: quietMs, cap: timeoutMs }).catch(() => new Promise(resolve => setTimeout(resolve, quietMs)));
}

function resolveProfileValue(value, profile = {}) {
  const token = String(value || '').toLowerCase().replace(/_/g, '');
  if (token === 'googleemail' || token === 'defaultusername') return profile.email || '';
  if (token === 'googlepassword' || token === 'defaultpassword') return '';
  return value;
}

export async function act(page, rawAction, ctx = {}) {
  const action = validateExecutionAction(rawAction);

  const startedAt = new Date().toISOString();
  let result = '';
  const el = await findActionElement(page, action);
  if (!el) throw new Error(`element_not_found: ${action.selector || action.ref}`);
  const info = await elementInfo(page, el);
  if (info.disabled) throw new Error(`form_incompatible: disabled element ${action.selector || action.ref}`);
  if (action.type === 'click' && !action.description) action.description = info.text;
  await enforcePermission(page, action, ctx);

  switch (action.type) {
    case 'fill': {
      const value = resolveProfileValue(action.value, ctx.profile);
      if (info.type === 'checkbox' || info.type === 'radio' || info.role === 'checkbox' || info.role === 'radio') {
        if (!await readChoiceState(page, el)) await clickElement(page, el);
        result = 'Checked choice while handling fill action';
      } else {
        await focusAndType(page, el, value);
        result = `Typed ${String(value ?? '').length} character(s)`;
      }
      break;
    }
    case 'select': {
      const value = resolveProfileValue(action.value, ctx.profile);
      if (info.isNativeSelect || action.optionKind === 'native_select') {
        result = await nativeSelect(page, el, value);
      } else {
        result = await customSelect(page, el, value);
      }
      break;
    }
    case 'check': {
      if (!await readChoiceState(page, el)) await clickElement(page, el);
      result = 'Checked';
      break;
    }
    case 'upload': {
      const filePath = ctx.profile?.resumePdfPath;
      if (!filePath || !fs.existsSync(filePath)) throw new Error(`element_not_found: resume PDF not found at ${filePath || '(unset)'}`);
      result = await uploadFile(page, el, filePath);
      break;
    }
    case 'signature': {
      result = await drawSignature(page, el);
      break;
    }
    case 'click': {
      result = `Clicked ${info.text || action.selector || action.ref}`;
      await clickElement(page, el);
      break;
    }
    default:
      throw new Error(`form_incompatible: unsupported action ${action.type}`);
  }

  await waitForStable(page);
  const stepResult = {
    action,
    result,
    startedAt,
    finishedAt: new Date().toISOString(),
    url: pageUrl(page)
  };
  await ctx.run?.writeActionResult?.(page, ctx.step || 0, stepResult).catch(() => {});
  ctx.logger?.info?.(stepResult, 'action_result');
  return result;
}
