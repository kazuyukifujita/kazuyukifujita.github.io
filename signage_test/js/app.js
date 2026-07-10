import { CloudField } from "./cloudField.js";
import { ThreadModal, ConfirmModal } from "./modal.js";
import { loadComments, saveComments } from "./storage.js";
import { createSpeechRecognizer, isSpeechSupported } from "./speech.js";

const cloudLayer = document.getElementById("cloud-layer");
const emptyState = document.getElementById("empty-state");
const hint = document.getElementById("hint");
const toastEl = document.getElementById("toast");

const commentInput = document.getElementById("comment-input");
const sendBtn = document.getElementById("send-btn");
const micBtn = document.getElementById("mic-btn");
const threadMicBtn = document.getElementById("thread-mic-btn");
const threadReplyInput = document.getElementById("thread-reply-input");

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2600);
}

function updateEmptyState() {
  if (cloudField.hasClouds()) {
    emptyState.classList.add("hidden");
  } else {
    emptyState.classList.remove("hidden");
  }
}

function fadeHint() {
  hint.classList.add("faded");
}

let saveScheduled = false;
function persist() {
  if (saveScheduled) return;
  saveScheduled = true;
  requestAnimationFrame(() => {
    saveScheduled = false;
    saveComments(cloudField.serialize());
  });
}

function confirmDeleteMessage(cloud) {
  return cloud.replies.length > 0
    ? `このコメントを削除しますか？\n返信 ${cloud.replies.length} 件もすべて削除されます。`
    : "このコメントを削除しますか？";
}

const confirmModal = new ConfirmModal();

const threadModal = new ThreadModal({
  onReply(cloudId, text) {
    cloudField.addReply(cloudId, text);
    const cloud = cloudField.getCloud(cloudId);
    if (cloud) threadModal.refresh(cloud);
    persist();
  },
  onDeleteReply(cloudId, replyId) {
    confirmModal.open("この返信を削除しますか？", () => {
      cloudField.deleteReply(cloudId, replyId);
      const cloud = cloudField.getCloud(cloudId);
      if (cloud) threadModal.refresh(cloud);
      persist();
    });
  },
  onDeleteRoot(cloudId) {
    const cloud = cloudField.getCloud(cloudId);
    if (!cloud) return;
    confirmModal.open(confirmDeleteMessage(cloud), () => {
      cloudField.deleteCloud(cloudId);
      threadModal.close();
      updateEmptyState();
      persist();
    });
  },
});

const cloudField = new CloudField(cloudLayer, {
  onOpenThread(cloudId) {
    const cloud = cloudField.getCloud(cloudId);
    if (cloud) threadModal.open(cloud);
  },
  onRequestDelete(cloudId) {
    const cloud = cloudField.getCloud(cloudId);
    if (!cloud) return;
    confirmModal.open(confirmDeleteMessage(cloud), () => {
      cloudField.deleteCloud(cloudId);
      if (threadModal.isOpenFor(cloudId)) threadModal.close();
      updateEmptyState();
      persist();
    });
  },
});

function submitComment() {
  const text = commentInput.value.trim();
  if (!text) {
    showToast("コメントを入力してください");
    return;
  }
  cloudField.addComment(text);
  commentInput.value = "";
  updateEmptyState();
  fadeHint();
  persist();
}

sendBtn.addEventListener("click", submitComment);
commentInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitComment();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    threadModal.close();
    confirmModal.close();
  }
});

function wireMic(button, targetInput) {
  if (!button) return;
  if (!isSpeechSupported()) {
    button.disabled = true;
    button.title = "この端末は音声入力に対応していません";
    button.style.opacity = "0.35";
    return;
  }

  let recognizer = null;
  let listening = false;

  button.addEventListener("click", () => {
    if (listening && recognizer) {
      recognizer.stop();
      return;
    }
    recognizer = createSpeechRecognizer({
      onStart() {
        listening = true;
        button.classList.add("listening");
      },
      onEnd() {
        listening = false;
        button.classList.remove("listening");
      },
      onError(event) {
        listening = false;
        button.classList.remove("listening");
        if (event && event.error !== "no-speech" && event.error !== "aborted") {
          showToast("音声入力でエラーが発生しました");
        }
      },
      onResult(transcript) {
        targetInput.value = transcript;
      },
    });
    targetInput.focus();
    recognizer.start();
  });
}

wireMic(micBtn, commentInput);
wireMic(threadMicBtn, threadReplyInput);

function createStars(count = 70) {
  const starsContainer = document.getElementById("stars");
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const star = document.createElement("div");
    star.className = "star";
    star.style.left = `${(Math.random() * 100).toFixed(2)}%`;
    star.style.top = `${(Math.random() * 65).toFixed(2)}%`;
    star.style.animationDelay = `${(Math.random() * 4).toFixed(2)}s`;
    star.style.animationDuration = `${(3 + Math.random() * 3).toFixed(2)}s`;
    frag.appendChild(star);
  }
  starsContainer.appendChild(frag);
}

function createBgClouds(count = 6) {
  const bgContainer = document.getElementById("bg-clouds");
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const cloud = document.createElement("div");
    cloud.className = "bg-cloud";
    const w = 240 + Math.random() * 260;
    const h = w * (0.45 + Math.random() * 0.15);
    cloud.style.setProperty("--w", `${w.toFixed(0)}px`);
    cloud.style.setProperty("--h", `${h.toFixed(0)}px`);
    cloud.style.setProperty("--top", `${(5 + Math.random() * 55).toFixed(1)}%`);
    cloud.style.setProperty("--o", `${(0.12 + Math.random() * 0.18).toFixed(2)}`);
    cloud.style.setProperty("--dur", `${(140 + Math.random() * 140).toFixed(0)}s`);
    cloud.style.setProperty("--delay", `${(-Math.random() * 140).toFixed(1)}s`);
    frag.appendChild(cloud);
  }
  bgContainer.appendChild(frag);
}

function init() {
  createStars();
  createBgClouds();

  cloudField.setBounds(window.innerWidth, window.innerHeight);
  const initial = loadComments();
  cloudField.loadInitial(initial);
  updateEmptyState();
  if (initial.length > 0) fadeHint();

  window.addEventListener("resize", () => {
    cloudField.setBounds(window.innerWidth, window.innerHeight);
  });

  let lastTime = performance.now();
  function loop(now) {
    const dt = now - lastTime;
    lastTime = now;
    cloudField.tick(dt);
    cloudField.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  setInterval(() => saveComments(cloudField.serialize()), 5000);
  window.addEventListener("beforeunload", () => {
    saveComments(cloudField.serialize());
  });
}

init();
