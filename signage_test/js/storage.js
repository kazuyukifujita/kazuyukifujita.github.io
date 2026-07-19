// localStorage への永続化。キオスク端末の再起動・再読み込みに耐えるための保存のみを担当する。

const STORAGE_KEY = "cloud-signage:comments:v1";

/**
 * @returns {Array<object>} 保存されていたコメント配列（無ければ空配列）
 */
export function loadComments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[storage] failed to load comments", err);
    return [];
  }
}

/**
 * @param {Array<object>} comments
 */
export function saveComments(comments) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
  } catch (err) {
    console.warn("[storage] failed to save comments", err);
  }
}
