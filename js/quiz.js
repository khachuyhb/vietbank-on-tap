export const SESSION_SCHEMA_VERSION = 1;

export function isAnswered(answer) {
  return Array.isArray(answer) && answer.length > 0;
}

export function isCorrect(question, answer = []) {
  if (!isAnswered(answer)) return false;
  if (answer.length !== question.correct.length) return false;
  const selected = new Set(answer);
  return question.correct.every((id) => selected.has(id));
}

export function shuffle(values, random = Math.random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function chooseQuestionNumbers(questions, count, order, random = Math.random) {
  const numbers = questions.map((question) => question.number);
  const ordered = order === "original" ? numbers : shuffle(numbers, random);
  const requested = count === "all" ? ordered.length : Number(count);
  return ordered.slice(0, Math.min(requested, ordered.length));
}

export function createSession(questionNumbers, mode = "submit") {
  const now = new Date().toISOString();
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    status: "active",
    mode,
    questionNumbers: [...questionNumbers],
    currentIndex: 0,
    answers: {},
    checked: {},
    startedAt: now,
    updatedAt: now,
  };
}

export function calculateResults(session, questionMap) {
  const detail = session.questionNumbers.map((number) => {
    const question = questionMap.get(number);
    const answer = session.answers[String(number)] ?? [];
    const status = !isAnswered(answer)
      ? "blank"
      : isCorrect(question, answer)
        ? "correct"
        : "wrong";
    return { number, question, answer, status };
  });
  const correct = detail.filter((item) => item.status === "correct").length;
  const wrong = detail.filter((item) => item.status === "wrong").length;
  const blank = detail.filter((item) => item.status === "blank").length;
  const score = Number(((correct / detail.length) * 100).toFixed(2));
  return { total: detail.length, correct, wrong, blank, score, detail };
}

export function validateSession(candidate, questions) {
  if (!candidate || typeof candidate !== "object") return { valid: false, reason: "Dữ liệu lưu không đúng định dạng." };
  if (candidate.schemaVersion !== SESSION_SCHEMA_VERSION) return { valid: false, reason: "Phiên bản bài đã lưu không còn tương thích." };
  if (!["submit", "instant"].includes(candidate.mode)) return { valid: false, reason: "Chế độ làm bài không hợp lệ." };
  if (!["active", "completed"].includes(candidate.status)) return { valid: false, reason: "Trạng thái bài đã lưu không hợp lệ." };
  if (!Array.isArray(candidate.questionNumbers) || candidate.questionNumbers.length === 0) return { valid: false, reason: "Danh sách câu hỏi đã lưu bị thiếu." };

  const questionMap = new Map(questions.map((question) => [question.number, question]));
  const uniqueNumbers = new Set(candidate.questionNumbers);
  if (uniqueNumbers.size !== candidate.questionNumbers.length || candidate.questionNumbers.some((number) => !Number.isInteger(number) || !questionMap.has(number))) {
    return { valid: false, reason: "Danh sách câu hỏi đã lưu không còn phù hợp." };
  }
  if (!Number.isInteger(candidate.currentIndex) || candidate.currentIndex < 0 || candidate.currentIndex >= candidate.questionNumbers.length) {
    return { valid: false, reason: "Vị trí câu hỏi đã lưu không hợp lệ." };
  }
  if (!candidate.answers || typeof candidate.answers !== "object" || Array.isArray(candidate.answers)) return { valid: false, reason: "Phần đáp án đã lưu bị lỗi." };

  for (const [numberText, answer] of Object.entries(candidate.answers)) {
    const number = Number(numberText);
    const question = questionMap.get(number);
    if (!uniqueNumbers.has(number) || !question || !Array.isArray(answer)) return { valid: false, reason: "Có đáp án không thuộc lượt ôn hiện tại." };
    const optionIds = new Set(question.options.map((option) => option.id));
    if (new Set(answer).size !== answer.length || answer.some((id) => !optionIds.has(id))) return { valid: false, reason: `Đáp án đã lưu của câu ${number} không hợp lệ.` };
    if (question.type === "single" && answer.length > 1) return { valid: false, reason: `Câu ${number} chỉ được chọn một đáp án.` };
  }

  if (!candidate.checked || typeof candidate.checked !== "object" || Array.isArray(candidate.checked)) return { valid: false, reason: "Trạng thái chấm câu đã lưu bị lỗi." };
  for (const [numberText, value] of Object.entries(candidate.checked)) {
    if (!uniqueNumbers.has(Number(numberText)) || typeof value !== "boolean") return { valid: false, reason: "Trạng thái chấm câu đã lưu không hợp lệ." };
  }
  return { valid: true, session: candidate };
}
