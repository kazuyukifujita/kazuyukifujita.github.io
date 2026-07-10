// コメントの「雲」を画面上に浮かべ、ゆっくり漂わせる物理シミュレーション兼レンダラー。
// - お互いに重ならないように弱く反発する
// - トピックが似ているコメント同士は弱く引き寄せ合う
// - スレッド返信は雲そのものは増やさず、バッジの件数のみ増える

import { toBigramMap, bigramSimilarity } from "./similarity.js";

const REPULSION_PADDING = 16;
const WANDER_STRENGTH = 0.05;
const REPULSION_STRENGTH = 0.024;
const ATTRACTION_STRENGTH = 0.0026;
const ATTRACTION_MIN_SIM = 0.16;
const ATTRACTION_MAX_RANGE = 520;
// 反発ゾーンのすぐ外側に「無風地帯」を設け、その先で引力を滑らかに立ち上げる。
// こうしないと反発と引力の境界で力が不連続になり、雲がガタガタ振動してしまう。
const ATTRACTION_DEAD_ZONE = 60;
const ATTRACTION_RAMP = 140;
const MAX_SPEED = 0.05; // px/ms
const DAMPING = 0.965;
const TOP_MARGIN = 96;
const BOTTOM_MARGIN = 140;
const SIDE_MARGIN = 56;
const MAX_FRAME_DT = 48;

const PALETTES = [
  { tint: "#eef1ff", glow: "rgba(163, 177, 255, 0.35)" }, // lavender
  { tint: "#eafff3", glow: "rgba(129, 230, 184, 0.35)" }, // mint
  { tint: "#fff1e8", glow: "rgba(255, 176, 122, 0.35)" }, // peach
  { tint: "#e9f6ff", glow: "rgba(126, 199, 255, 0.35)" }, // sky
  { tint: "#fdeef7", glow: "rgba(255, 150, 205, 0.32)" }, // rose
  { tint: "#fffceb", glow: "rgba(255, 214, 110, 0.35)" }, // butter
];

function generateId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function pairKey(idA, idB) {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function hashToIndex(str, mod) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h % mod;
}

function computeDiameter(text, replyCount) {
  const len = text.length;
  const base = 108;
  const growth = Math.sqrt(len) * 15;
  const replyBonus = Math.min(replyCount * 5, 50);
  return clamp(base + growth + replyBonus, 110, 300);
}

function computeFontSize(text, diameter) {
  const len = text.length;
  let size = diameter / 7.2;
  if (len > 20) size *= 0.9;
  if (len > 40) size *= 0.82;
  return clamp(size, 13, 26);
}

export class CloudField {
  /**
   * @param {HTMLElement} container
   * @param {{onOpenThread?: (id: string) => void, onRequestDelete?: (id: string) => void}} handlers
   */
  constructor(container, handlers = {}) {
    this.container = container;
    this.onOpenThread = handlers.onOpenThread;
    this.onRequestDelete = handlers.onRequestDelete;
    this.onLike = handlers.onLike;
    this.clouds = new Map();
    this.simCache = new Map();
    this.bounds = { width: window.innerWidth, height: window.innerHeight };
    this.elapsed = 0;
  }

  setBounds(width, height) {
    this.bounds.width = width;
    this.bounds.height = height;
    for (const c of this.clouds.values()) {
      c.x = clamp(c.x, SIDE_MARGIN + c.r, Math.max(SIDE_MARGIN + c.r, width - SIDE_MARGIN - c.r));
      c.y = clamp(c.y, TOP_MARGIN + c.r, Math.max(TOP_MARGIN + c.r, height - BOTTOM_MARGIN - c.r));
    }
  }

  hasClouds() {
    return this.clouds.size > 0;
  }

  loadInitial(commentsData) {
    for (const data of commentsData) {
      this._createCloud(data, { spawnAnim: false });
    }
    this._rebuildSimCache();
  }

  addComment(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const data = {
      id: generateId(),
      text: trimmed,
      createdAt: Date.now(),
      replies: [],
      x: this.bounds.width / 2 + (Math.random() - 0.5) * 140,
      y: this.bounds.height - BOTTOM_MARGIN - 30,
    };
    const cloud = this._createCloud(data, { spawnAnim: true });
    cloud.vx = (Math.random() - 0.5) * 0.05;
    cloud.vy = -0.07 - Math.random() * 0.04;
    this._rebuildSimCache();
    return cloud;
  }

  addReply(cloudId, text) {
    const cloud = this.clouds.get(cloudId);
    if (!cloud) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    const reply = { id: generateId(), text: trimmed, createdAt: Date.now(), likes: 0 };
    cloud.replies.push(reply);
    this._resize(cloud);
    return reply;
  }

  deleteReply(cloudId, replyId) {
    const cloud = this.clouds.get(cloudId);
    if (!cloud) return;
    cloud.replies = cloud.replies.filter((r) => r.id !== replyId);
    this._resize(cloud);
  }

  likeCloud(cloudId) {
    const cloud = this.clouds.get(cloudId);
    if (!cloud) return null;
    cloud.likes = (cloud.likes || 0) + 1;
    this._applyBadges(cloud);
    return cloud.likes;
  }

  likeReply(cloudId, replyId) {
    const cloud = this.clouds.get(cloudId);
    if (!cloud) return null;
    const reply = cloud.replies.find((r) => r.id === replyId);
    if (!reply) return null;
    reply.likes = (reply.likes || 0) + 1;
    return reply.likes;
  }

  deleteCloud(cloudId) {
    const cloud = this.clouds.get(cloudId);
    if (!cloud) return;
    cloud.el.classList.add("removing");
    const anchorEl = cloud.anchorEl;
    this.clouds.delete(cloudId);
    this._rebuildSimCache();
    setTimeout(() => anchorEl.remove(), 460);
  }

  getCloud(id) {
    return this.clouds.get(id);
  }

  serialize() {
    return Array.from(this.clouds.values()).map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt,
      replies: c.replies,
      likes: c.likes || 0,
      x: Math.round(c.x),
      y: Math.round(c.y),
    }));
  }

  _createCloud(data, { spawnAnim }) {
    const bigrams = toBigramMap(data.text);
    const replies = data.replies || [];
    const d = computeDiameter(data.text, replies.length);
    const state = {
      id: data.id,
      text: data.text,
      createdAt: data.createdAt,
      replies,
      likes: typeof data.likes === "number" ? data.likes : 0,
      bigrams,
      d,
      r: d / 2,
      x: typeof data.x === "number" ? data.x : this.bounds.width / 2 + (Math.random() - 0.5) * 200,
      y: typeof data.y === "number" ? data.y : this.bounds.height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
      ax: 0,
      ay: 0,
      phase: Math.random() * Math.PI * 2,
      freq1: 0.15 + Math.random() * 0.1,
      freq2: 0.05 + Math.random() * 0.05,
      paletteIndex: hashToIndex(data.id, PALETTES.length),
      dragging: false,
      dragPointerId: null,
      dragMoved: 0,
      suppressClick: false,
    };

    const anchor = document.createElement("div");
    anchor.className = "cloud-anchor";

    const bubble = document.createElement("div");
    bubble.className = "cloud-bubble" + (spawnAnim ? " spawning" : "");
    bubble.style.setProperty("--phase-delay", `${(-Math.random() * 14).toFixed(2)}s`);
    const palette = PALETTES[state.paletteIndex];
    bubble.style.setProperty("--cloud-tint", palette.tint);
    bubble.style.setProperty("--cloud-glow", palette.glow);
    bubble.tabIndex = 0;
    bubble.setAttribute("role", "button");
    bubble.setAttribute("aria-label", `コメント: ${data.text}`);

    const textEl = document.createElement("p");
    textEl.className = "cloud-text";
    textEl.textContent = data.text;
    bubble.appendChild(textEl);

    const badge = document.createElement("span");
    badge.className = "cloud-badge";
    const badgeCount = document.createElement("span");
    badgeCount.className = "badge-count";
    badge.append("💬 ", badgeCount);
    bubble.appendChild(badge);

    const likeBtn = document.createElement("button");
    likeBtn.className = "cloud-like";
    likeBtn.type = "button";
    likeBtn.setAttribute("aria-label", "いいね");
    const likeIcon = document.createElement("span");
    likeIcon.className = "like-icon";
    likeIcon.textContent = "👍";
    const likeCount = document.createElement("span");
    likeCount.className = "like-count";
    likeBtn.appendChild(likeIcon);
    likeBtn.appendChild(likeCount);
    likeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.likeCloud(state.id);
      likeBtn.classList.remove("liked-pop");
      // force reflow so the animation can restart on repeated clicks
      void likeBtn.offsetWidth;
      likeBtn.classList.add("liked-pop");
      this.onLike && this.onLike(state.id);
    });
    bubble.appendChild(likeBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "cloud-delete";
    deleteBtn.type = "button";
    deleteBtn.setAttribute("aria-label", "このコメントを削除");
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      this.onRequestDelete && this.onRequestDelete(state.id);
    });
    bubble.appendChild(deleteBtn);

    const openThread = () => {
      if (state.suppressClick) {
        state.suppressClick = false;
        return;
      }
      this.onOpenThread && this.onOpenThread(state.id);
    };
    bubble.addEventListener("click", openThread);
    bubble.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openThread();
      }
    });

    const DRAG_CLICK_THRESHOLD = 6;
    let dragStartClientX = 0;
    let dragStartClientY = 0;
    let dragStartX = 0;
    let dragStartY = 0;

    bubble.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".cloud-delete") || event.target.closest(".cloud-like")) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      state.dragging = true;
      state.dragPointerId = event.pointerId;
      state.dragMoved = 0;
      dragStartClientX = event.clientX;
      dragStartClientY = event.clientY;
      dragStartX = state.x;
      dragStartY = state.y;
      bubble.classList.add("dragging");
      bubble.setPointerCapture(event.pointerId);
    });

    bubble.addEventListener("pointermove", (event) => {
      if (!state.dragging || event.pointerId !== state.dragPointerId) return;
      const dx = event.clientX - dragStartClientX;
      const dy = event.clientY - dragStartClientY;
      state.dragMoved = Math.max(state.dragMoved, Math.hypot(dx, dy));
      state.x = clamp(dragStartX + dx, state.r, Math.max(state.r, this.bounds.width - state.r));
      state.y = clamp(dragStartY + dy, state.r, Math.max(state.r, this.bounds.height - state.r));
      this._applyTransform(state);
    });

    const endDrag = (event) => {
      if (!state.dragging || event.pointerId !== state.dragPointerId) return;
      state.dragging = false;
      state.dragPointerId = null;
      bubble.classList.remove("dragging");
      if (bubble.hasPointerCapture(event.pointerId)) {
        bubble.releasePointerCapture(event.pointerId);
      }
      if (state.dragMoved > DRAG_CLICK_THRESHOLD) {
        state.suppressClick = true;
      }
    };
    bubble.addEventListener("pointerup", endDrag);
    bubble.addEventListener("pointercancel", endDrag);

    anchor.appendChild(bubble);
    this.container.appendChild(anchor);

    state.el = bubble;
    state.anchorEl = anchor;
    state.textEl = textEl;
    state.badgeEl = badge;
    state.badgeCountEl = badgeCount;
    state.likeBtn = likeBtn;
    state.likeCountEl = likeCount;

    this._applySize(state);
    this._applyBadges(state);
    this._applyTransform(state);

    this.clouds.set(state.id, state);
    return state;
  }

  _resize(cloud) {
    cloud.d = computeDiameter(cloud.text, cloud.replies.length);
    cloud.r = cloud.d / 2;
    this._applySize(cloud);
    this._applyBadges(cloud);
  }

  _applySize(cloud) {
    cloud.el.style.setProperty("--d", `${cloud.d}px`);
    cloud.el.style.fontSize = `${computeFontSize(cloud.text, cloud.d).toFixed(1)}px`;
  }

  _applyBadges(cloud) {
    const count = cloud.replies.length;
    if (count > 0) {
      cloud.badgeEl.classList.add("visible");
      cloud.badgeCountEl.textContent = String(count);
    } else {
      cloud.badgeEl.classList.remove("visible");
    }
    const likes = cloud.likes || 0;
    if (likes > 0) {
      cloud.likeCountEl.textContent = String(likes);
      cloud.likeCountEl.classList.add("visible");
    } else {
      cloud.likeCountEl.textContent = "";
      cloud.likeCountEl.classList.remove("visible");
    }
  }

  _applyTransform(cloud) {
    cloud.anchorEl.style.transform = `translate3d(${cloud.x.toFixed(1)}px, ${cloud.y.toFixed(1)}px, 0)`;
  }

  _rebuildSimCache() {
    this.simCache.clear();
    const list = Array.from(this.clouds.values());
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const sim = bigramSimilarity(list[i].bigrams, list[j].bigrams);
        if (sim >= ATTRACTION_MIN_SIM) {
          this.simCache.set(pairKey(list[i].id, list[j].id), sim);
        }
      }
    }
  }

  tick(dtMs) {
    const dt = Math.min(dtMs, MAX_FRAME_DT);
    if (dt <= 0) return;
    this.elapsed += dt;
    const list = Array.from(this.clouds.values());
    if (list.length === 0) return;

    for (const c of list) {
      const t = this.elapsed / 1000 + c.phase;
      const wx = Math.sin(t * c.freq1) * 0.7 + Math.sin(t * c.freq2 + 1.7) * 0.3;
      const wy = Math.cos(t * c.freq1 * 0.9 + 0.5) * 0.7 + Math.sin(t * c.freq2 * 1.3 + 2.1) * 0.3;
      c.ax = wx * WANDER_STRENGTH;
      c.ay = wy * WANDER_STRENGTH;
    }

    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.001) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dist = 0.001;
        }
        const minDist = a.r + b.r + REPULSION_PADDING;
        const restDist = minDist + ATTRACTION_DEAD_ZONE;
        if (dist < minDist) {
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          const force = overlap * REPULSION_STRENGTH;
          const totalR = a.r + b.r;
          const aShare = b.r / totalR;
          const bShare = a.r / totalR;
          a.ax -= nx * force * aShare;
          a.ay -= ny * force * aShare;
          b.ax += nx * force * bShare;
          b.ay += ny * force * bShare;
        } else if (dist > restDist && dist < ATTRACTION_MAX_RANGE) {
          const sim = this.simCache.get(pairKey(a.id, b.id));
          if (sim) {
            // restDist〜restDist+ATTRACTION_RAMPの範囲で0→1へなめらかに立ち上げ、
            // 反発ゾーン境界での急激な力の反転(=振動)を防ぐ。
            const t = clamp((dist - restDist) / ATTRACTION_RAMP, 0, 1);
            const ramp = t * t * (3 - 2 * t);
            const nx = dx / dist;
            const ny = dy / dist;
            const force = sim * ATTRACTION_STRENGTH * ramp * Math.min(dist, 260);
            a.ax += nx * force;
            a.ay += ny * force;
            b.ax -= nx * force;
            b.ay -= ny * force;
          }
        }
      }
    }

    for (const c of list) {
      if (c.dragging) {
        // ポインタ操作中は物理演算をスキップし、位置はドラッグハンドラ側で直接更新する。
        c.vx = 0;
        c.vy = 0;
        continue;
      }

      const left = SIDE_MARGIN + c.r;
      const right = Math.max(left, this.bounds.width - SIDE_MARGIN - c.r);
      const top = TOP_MARGIN + c.r;
      const bottom = Math.max(top, this.bounds.height - BOTTOM_MARGIN - c.r);

      if (c.x < left) c.ax += (left - c.x) * 0.007;
      if (c.x > right) c.ax -= (c.x - right) * 0.007;
      if (c.y < top) c.ay += (top - c.y) * 0.007;
      if (c.y > bottom) c.ay -= (c.y - bottom) * 0.007;

      c.vx = (c.vx + c.ax * dt) * DAMPING;
      c.vy = (c.vy + c.ay * dt) * DAMPING;

      const speed = Math.hypot(c.vx, c.vy);
      if (speed > MAX_SPEED) {
        const scale = MAX_SPEED / speed;
        c.vx *= scale;
        c.vy *= scale;
      }

      c.x += c.vx * dt;
      c.y += c.vy * dt;

      c.x = clamp(c.x, c.r, Math.max(c.r, this.bounds.width - c.r));
      c.y = clamp(c.y, c.r, Math.max(c.r, this.bounds.height - c.r));
    }
  }

  render() {
    for (const c of this.clouds.values()) {
      this._applyTransform(c);
    }
  }
}
