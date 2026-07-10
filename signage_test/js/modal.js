// スレッド表示モーダルと削除確認モーダルの開閉・描画ロジック。

function formatTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export class ThreadModal {
  /**
   * @param {{onReply: (cloudId: string, text: string) => void, onDeleteReply: (cloudId: string, replyId: string) => void, onDeleteRoot: (cloudId: string) => void, onLikeRoot: (cloudId: string) => void, onLikeReply: (cloudId: string, replyId: string) => void}} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.overlay = document.getElementById("thread-modal");
    this.rootTextEl = document.getElementById("thread-root-text");
    this.rootTimeEl = document.getElementById("thread-root-time");
    this.rootLikeBtn = document.getElementById("thread-root-like");
    this.rootLikeCountEl = document.getElementById("thread-root-like-count");
    this.repliesEl = document.getElementById("thread-replies");
    this.replyInput = document.getElementById("thread-reply-input");
    this.replySendBtn = document.getElementById("thread-reply-send");
    this.closeBtn = document.getElementById("thread-close");
    this.rootDeleteBtn = document.getElementById("thread-root-delete");
    this.currentCloudId = null;

    this.closeBtn.addEventListener("click", () => this.close());
    this.rootDeleteBtn.addEventListener("click", () => {
      if (this.currentCloudId) this.handlers.onDeleteRoot(this.currentCloudId);
    });
    this.rootLikeBtn.addEventListener("click", () => {
      if (this.currentCloudId) this.handlers.onLikeRoot(this.currentCloudId);
    });
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.replySendBtn.addEventListener("click", () => this._submitReply());
    this.replyInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this._submitReply();
      }
    });
  }

  _submitReply() {
    const text = this.replyInput.value.trim();
    if (!text || !this.currentCloudId) return;
    this.handlers.onReply(this.currentCloudId, text);
    this.replyInput.value = "";
  }

  open(cloud) {
    this.currentCloudId = cloud.id;
    this.rootTextEl.textContent = cloud.text;
    this.rootTimeEl.textContent = formatTime(cloud.createdAt);
    this.rootLikeCountEl.textContent = String(cloud.likes || 0);
    this._renderReplies(cloud);
    this.overlay.classList.remove("hidden");
    this.replyInput.value = "";
    setTimeout(() => this.replyInput.focus(), 50);
  }

  refresh(cloud) {
    if (this.currentCloudId !== cloud.id) return;
    this.rootLikeCountEl.textContent = String(cloud.likes || 0);
    this._renderReplies(cloud);
  }

  _renderReplies(cloud) {
    this.repliesEl.innerHTML = "";
    if (cloud.replies.length === 0) {
      const empty = document.createElement("p");
      empty.className = "thread-reply-empty";
      empty.textContent = "まだ返信はありません。最初の返信を送ってみましょう。";
      this.repliesEl.appendChild(empty);
      return;
    }
    for (const reply of cloud.replies) {
      const item = document.createElement("div");
      item.className = "reply-item";

      const body = document.createElement("div");
      body.className = "reply-body";
      const textEl = document.createElement("p");
      textEl.className = "reply-text";
      textEl.textContent = reply.text;
      const timeEl = document.createElement("span");
      timeEl.className = "reply-time";
      timeEl.textContent = formatTime(reply.createdAt);
      body.appendChild(textEl);
      body.appendChild(timeEl);

      const actions = document.createElement("div");
      actions.className = "reply-actions";

      const likeBtn = document.createElement("button");
      likeBtn.className = "reply-like";
      likeBtn.type = "button";
      likeBtn.setAttribute("aria-label", "この返信にいいね");
      const likeCountEl = document.createElement("span");
      likeCountEl.className = "reply-like-count";
      likeCountEl.textContent = String(reply.likes || 0);
      likeBtn.append("🤍 ", likeCountEl);
      likeBtn.addEventListener("click", () => {
        this.handlers.onLikeReply(cloud.id, reply.id);
      });

      const delBtn = document.createElement("button");
      delBtn.className = "reply-delete";
      delBtn.type = "button";
      delBtn.textContent = "×";
      delBtn.setAttribute("aria-label", "この返信を削除");
      delBtn.addEventListener("click", () => {
        this.handlers.onDeleteReply(cloud.id, reply.id);
      });

      actions.appendChild(likeBtn);
      actions.appendChild(delBtn);

      item.appendChild(body);
      item.appendChild(actions);
      this.repliesEl.appendChild(item);
    }
  }

  close() {
    this.overlay.classList.add("hidden");
    this.currentCloudId = null;
  }

  isOpenFor(cloudId) {
    return this.currentCloudId === cloudId;
  }
}

export class ConfirmModal {
  constructor() {
    this.overlay = document.getElementById("confirm-modal");
    this.messageEl = document.getElementById("confirm-message");
    this.okBtn = document.getElementById("confirm-ok");
    this.cancelBtn = document.getElementById("confirm-cancel");
    this._onConfirm = null;

    this.okBtn.addEventListener("click", () => {
      const cb = this._onConfirm;
      this.close();
      if (cb) cb();
    });
    this.cancelBtn.addEventListener("click", () => this.close());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.close();
    });
  }

  open(message, onConfirm) {
    this.messageEl.textContent = message;
    this._onConfirm = onConfirm;
    this.overlay.classList.remove("hidden");
  }

  close() {
    this.overlay.classList.add("hidden");
    this._onConfirm = null;
  }
}
