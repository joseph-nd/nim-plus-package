/**
 * A deliberately tiny DOM for the module-misc tests (the harness runs under
 * plain Node with no DOM). Supports what the sheet/compendium decorators use:
 * createElement, append/remove, classList, dataset, style.setProperty,
 * attributes, textContent, innerHTML (stored; `<img>`/`<i>` children are
 * parsed shallowly), click listeners, and querySelector(All) for simple
 * selectors: tag, .class, #id, [attr], [attr="v"], compounds of those,
 * descendant combinators (space) and comma lists.
 *
 * installFakeDom() puts `document`, `HTMLElement`, `Element` and
 * `requestAnimationFrame` on globalThis and returns the document.
 */

class ClassList {
	constructor(el) {
		this.el = el;
		this.set = new Set();
	}
	add(...c) {
		for (const x of c) this.set.add(x);
	}
	remove(...c) {
		for (const x of c) this.set.delete(x);
	}
	contains(c) {
		return this.set.has(c);
	}
	toggle(c, force) {
		const on = force === undefined ? !this.set.has(c) : !!force;
		if (on) this.set.add(c);
		else this.set.delete(c);
		return on;
	}
	get value() {
		return [...this.set].join(' ');
	}
}

class Style {
	constructor() {
		this.props = new Map();
	}
	setProperty(k, v, p) {
		this.props.set(k, { value: v, priority: p ?? '' });
	}
	getPropertyValue(k) {
		return this.props.get(k)?.value ?? '';
	}
	getPropertyPriority(k) {
		return this.props.get(k)?.priority ?? '';
	}
}

export class FakeElement {
	constructor(tagName, ownerDocument) {
		this.tagName = String(tagName).toUpperCase();
		this.ownerDocument = ownerDocument;
		this.children = [];
		this.parentElement = null;
		this.classList = new ClassList(this);
		this.attributes = new Map();
		this.style = new Style();
		this.listeners = new Map();
		this._text = '';
		this._html = '';
		const self = this;
		this.dataset = new Proxy(
			{},
			{
				get(t, k) {
					return self.attributes.get(`data-${kebab(k)}`);
				},
				set(t, k, v) {
					self.attributes.set(`data-${kebab(k)}`, String(v));
					return true;
				},
				has(t, k) {
					return self.attributes.has(`data-${kebab(k)}`);
				},
			},
		);
	}
	get className() {
		return this.classList.value;
	}
	set className(v) {
		this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
	}
	get id() {
		return this.attributes.get('id') ?? '';
	}
	set id(v) {
		this.attributes.set('id', String(v));
	}
	get type() {
		return this.attributes.get('type');
	}
	set type(v) {
		this.attributes.set('type', v);
	}
	getAttribute(k) {
		if (k === 'class') return this.className;
		return this.attributes.has(k) ? this.attributes.get(k) : null;
	}
	setAttribute(k, v) {
		if (k === 'class') this.className = v;
		else this.attributes.set(k, String(v));
	}
	hasAttribute(k) {
		return k === 'class' ? this.classList.set.size > 0 : this.attributes.has(k);
	}
	get textContent() {
		return this._text + this.children.map((c) => c.textContent).join('');
	}
	set textContent(v) {
		for (const c of this.children) c.parentElement = null;
		this.children = [];
		this._text = String(v ?? '');
	}
	get innerHTML() {
		return this._html;
	}
	set innerHTML(v) {
		for (const c of this.children) c.parentElement = null;
		this.children = [];
		this._text = '';
		this._html = String(v ?? '');
		// Shallow parse of void/simple children: <img ...>, <i class="..."></i>
		for (const m of this._html.matchAll(/<(img|i|span)\b([^>]*)>/g)) {
			const child = new FakeElement(m[1], this.ownerDocument);
			for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) child.setAttribute(a[1], a[2]);
			this.appendChild(child);
		}
	}
	appendChild(child) {
		if (child.parentElement) child.remove();
		child.parentElement = this;
		this.children.push(child);
		return child;
	}
	append(...nodes) {
		for (const n of nodes) {
			if (typeof n === 'string') this._text += n;
			else this.appendChild(n);
		}
	}
	remove() {
		const p = this.parentElement;
		if (!p) return;
		p.children = p.children.filter((c) => c !== this);
		this.parentElement = null;
	}
	get isConnected() {
		let cur = this;
		while (cur.parentElement) cur = cur.parentElement;
		return cur === this.ownerDocument?.documentElement;
	}
	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(fn);
	}
	removeEventListener(type, fn) {
		const l = this.listeners.get(type);
		if (l) this.listeners.set(type, l.filter((f) => f !== fn));
	}
	dispatchEvent(event) {
		for (const fn of this.listeners.get(event.type) ?? []) fn(event);
		return true;
	}
	click() {
		this.dispatchEvent({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} });
	}
	*descendants() {
		for (const c of this.children) {
			yield c;
			yield* c.descendants();
		}
	}
	matches(selector) {
		return String(selector)
			.split(',')
			.some((s) => matchChain(this, s.trim().split(/\s+/)));
	}
	querySelectorAll(selector) {
		return [...this.descendants()].filter((el) => el.matches(selector));
	}
	querySelector(selector) {
		for (const el of this.descendants()) if (el.matches(selector)) return el;
		return null;
	}
	closest(selector) {
		let cur = this;
		while (cur) {
			if (cur.matches(selector)) return cur;
			cur = cur.parentElement;
		}
		return null;
	}
}

function kebab(k) {
	return String(k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function matchCompound(el, compound) {
	const re = /([#.]?)([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
	let m;
	let consumed = 0;
	while ((m = re.exec(compound))) {
		consumed += m[0].length;
		if (m[3]) {
			const v = el.getAttribute(m[3]);
			if (v === null) return false;
			if (m[4] !== undefined && v !== m[4]) return false;
		} else if (m[1] === '.') {
			if (!el.classList.contains(m[2])) return false;
		} else if (m[1] === '#') {
			if (el.id !== m[2]) return false;
		} else if (m[2] !== '*' && el.tagName !== m[2].toUpperCase()) return false;
	}
	return consumed > 0;
}

function matchChain(el, parts) {
	if (!parts.length) return true;
	const last = parts[parts.length - 1];
	if (!matchCompound(el, last)) return false;
	const rest = parts.slice(0, -1);
	if (!rest.length) return true;
	let anc = el.parentElement;
	while (anc) {
		if (matchChain(anc, rest)) return true;
		anc = anc.parentElement;
	}
	return false;
}

export function installFakeDom() {
	const doc = {
		createElement: (tag) => new FakeElement(tag, doc),
		getElementById: (id) => doc.documentElement.querySelector(`#${id}`),
		querySelector: (s) => doc.documentElement.querySelector(s),
		querySelectorAll: (s) => doc.documentElement.querySelectorAll(s),
	};
	doc.documentElement = new FakeElement('html', doc);
	doc.head = doc.createElement('head');
	doc.body = doc.createElement('body');
	doc.documentElement.append(doc.head, doc.body);
	globalThis.document = doc;
	globalThis.HTMLElement = FakeElement;
	globalThis.Element = FakeElement;
	globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
	return doc;
}

export function uninstallFakeDom() {
	delete globalThis.document;
	delete globalThis.HTMLElement;
	delete globalThis.Element;
	delete globalThis.requestAnimationFrame;
}

/** Build a small tree from a spec: el('div', {class:'a', 'data-x':'1'}, [children]). */
export function el(tag, attrs = {}, children = []) {
	const e = globalThis.document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === 'text') e.textContent = v;
		else e.setAttribute(k, v);
	}
	for (const c of children) e.append(c);
	return e;
}
