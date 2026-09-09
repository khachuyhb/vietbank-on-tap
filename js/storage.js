import { validateSession } from "./quiz.js";

export const STORAGE_KEY = "vietbank-on-tap:session:v1";

export function saveSession(session) {
  session.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function loadSession(questions) {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { session: null, error: null };
  try {
    const candidate = JSON.parse(raw);
    const validation = validateSession(candidate, questions);
    if (!validation.valid) {
      clearSession();
      return { session: null, error: validation.reason };
    }
    return { session: validation.session, error: null };
  } catch {
    clearSession();
    return { session: null, error: "Bài đã lưu bị hỏng nên đã được xóa an toàn." };
  }
}
