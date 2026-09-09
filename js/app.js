import { calculateResults, chooseQuestionNumbers, createSession, isAnswered, isCorrect } from "./quiz.js";
import { clearSession, loadSession, saveSession } from "./storage.js";

const app = document.querySelector("#app");
let questions = [];
let questionMap = new Map();
let session = null;
let restoreNotice = "";
let resultFilter = "all";
let scrollListener = null;
let scrollFrame = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(value));
  } catch {
    return "gần đây";
  }
}

function modeLabel(mode) {
  return mode === "instant" ? "Biết kết quả ngay" : "Làm hết rồi nộp";
}

function answerFor(number) {
  return session.answers[String(number)] ?? [];
}

function stopScrollTracking() {
  if (scrollListener) window.removeEventListener("scroll", scrollListener);
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollListener = null;
  scrollFrame = null;
}

function renderStart() {
  stopScrollTracking();
  document.body.dataset.view = "start";
  delete document.body.dataset.resultMode;
  const resumable = session && session.questionNumbers?.length;
  const answered = resumable
    ? session.questionNumbers.filter((number) => isAnswered(session.answers[String(number)])).length
    : 0;
  const resumeTitle = session?.status === "completed" ? "Kết quả gần nhất" : "Bài đang làm";
  const resumeAction = session?.status === "completed" ? "Xem lại kết quả" : "Tiếp tục bài đang làm";

  app.className = "app-shell";
  app.innerHTML = `
    <section class="start-screen" aria-labelledby="start-title">
      <div class="start-intro">
        <p class="eyebrow">Bộ câu hỏi nghiệp vụ</p>
        <h1 id="start-title">Chọn cách bạn muốn ôn tập</h1>
        <p>Làm một lượt ngắn để ghi nhớ nhanh, hoặc chọn toàn bộ câu hỏi để kiểm tra kiến thức.</p>
        ${restoreNotice ? `<div class="notice" role="status"><span aria-hidden="true">ⓘ</span><span>${escapeHtml(restoreNotice)}</span></div>` : ""}
        ${
          resumable
            ? `<aside class="resume-card" aria-label="${resumeTitle}">
                <div>
                  <span class="resume-kicker">${resumeTitle}</span>
                  <strong>${modeLabel(session.mode)} · ${session.questionNumbers.length} câu</strong>
                  <small>${session.status === "completed" ? "Đã hoàn thành" : `${answered}/${session.questionNumbers.length} câu đã chọn`} · cập nhật ${formatDate(session.updatedAt)}</small>
                </div>
                <div class="resume-actions">
                  <button class="primary-button" type="button" data-action="resume">${resumeAction}</button>
                  <button class="text-button" type="button" data-action="discard">Bắt đầu lượt mới</button>
                </div>
              </aside>`
            : ""
        }
      </div>

      <form class="setup-card" id="setup-form">
        <fieldset class="mode-grid">
          <legend>Chế độ làm bài</legend>
          <label class="choice-card is-selected">
            <input type="radio" name="mode" value="submit" checked />
            <span class="choice-icon" aria-hidden="true">✓</span>
            <span><strong>Làm hết rồi nộp</strong><small>Cuộn qua toàn bộ câu hỏi và sửa đáp án trước khi chấm điểm.</small></span>
          </label>
          <label class="choice-card">
            <input type="radio" name="mode" value="instant" />
            <span class="choice-icon" aria-hidden="true">⚡</span>
            <span><strong>Biết kết quả ngay</strong><small>Nhận phản hồi tại từng câu rồi tiếp tục cuộn xuống.</small></span>
          </label>
        </fieldset>

        <div class="setup-row">
          <fieldset>
            <legend>Số câu</legend>
            <div class="segment-control">
              <label><input type="radio" name="count" value="20" /><span>20</span></label>
              <label><input type="radio" name="count" value="50" checked /><span>50</span></label>
              <label><input type="radio" name="count" value="100" /><span>100</span></label>
              <label><input type="radio" name="count" value="all" /><span>Tất cả</span></label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Thứ tự</legend>
            <div class="inline-options">
              <label><input type="radio" name="order" value="random" checked /> Ngẫu nhiên</label>
              <label><input type="radio" name="order" value="original" /> Thứ tự gốc</label>
            </div>
          </fieldset>
        </div>
        <button class="primary-button start-button" type="submit">Bắt đầu ôn tập <span aria-hidden="true">→</span></button>
      </form>
    </section>`;
}

function questionStatus(number, forcedStatus) {
  const key = String(number);
  if (forcedStatus) return forcedStatus;
  if (!Object.hasOwn(session.checked, key)) return null;
  return session.checked[key] ? "correct" : "wrong";
}

function statusLabel(status) {
  if (status === "correct") return { icon: "✓", text: "Đúng" };
  if (status === "wrong") return { icon: "×", text: "Sai" };
  if (status === "blank") return { icon: "—", text: "Bỏ trống" };
  return null;
}

function navigatorStatus(number, resultMap = null) {
  if (resultMap) return resultMap.get(number)?.status ?? "blank";
  const key = String(number);
  if (Object.hasOwn(session.checked, key)) return session.checked[key] ? "correct" : "wrong";
  return isAnswered(answerFor(number)) ? "answered" : "blank";
}

function navigatorLabel(position, status, current) {
  const statusText = {
    answered: "đã trả lời",
    correct: "đúng",
    wrong: "sai",
    blank: "chưa trả lời",
  }[status];
  return `Câu ${position + 1}, ${statusText}${current ? ", đang xem" : ""}`;
}

function renderQuestionNavigator(results = null) {
  const resultMap = results ? new Map(results.detail.map((item) => [item.number, item])) : null;
  const numbers = session.questionNumbers.map((number, position) => {
    const status = navigatorStatus(number, resultMap);
    const current = position === session.currentIndex;
    return `<button class="nav-number is-${status}${current ? " is-current" : ""}" type="button" data-action="jump" data-number="${number}" data-position="${position}" aria-label="${navigatorLabel(position, status, current)}" ${current ? 'aria-current="true"' : ""}>${position + 1}</button>`;
  }).join("");
  const answered = results ? results.total - results.blank : answeredCount();
  const legend = results
    ? '<span><i class="legend-dot correct">✓</i> Đúng</span><span><i class="legend-dot wrong">×</i> Sai</span><span><i class="legend-dot blank"></i> Bỏ trống</span><span><i class="legend-dot current"></i> Đang xem</span>'
    : '<span><i class="legend-dot answered"></i> Đã trả lời</span><span><i class="legend-dot blank"></i> Chưa trả lời</span><span><i class="legend-dot current"></i> Đang xem</span>';

  return `<aside class="question-nav" aria-label="Danh sách câu hỏi">
    <div class="question-nav-inner">
      <div class="nav-heading"><h2>Danh sách câu hỏi</h2><button class="nav-close mobile-only" type="button" data-action="nav-close" aria-label="Đóng danh sách câu hỏi">×</button></div>
      <div class="nav-number-scroll"><div class="number-grid">${numbers}</div></div>
      <div class="nav-legend">${legend}</div>
      <div class="nav-summary" data-nav-summary>${results ? `Số câu chấm tự động: <strong>${results.total}/${results.total}</strong> câu` : `Đã trả lời: <strong>${answered}/${session.questionNumbers.length}</strong> câu`}</div>
      ${results ? `<div class="nav-score"><span>Tổng số điểm</span><strong>${results.score.toFixed(2)}/100</strong></div><button class="primary-button nav-finish" type="button" data-action="discard">Kết thúc xem</button>` : `<button class="primary-button nav-finish" type="button" data-action="finish">${session.mode === "instant" ? "Kết thúc" : "Nộp bài"}</button>`}
    </div>
  </aside>`;
}

function renderNavBackdrop() {
  return '<button class="nav-backdrop" type="button" data-action="nav-close" aria-label="Đóng danh sách câu hỏi"></button>';
}

function updateNavigatorState() {
  const nav = document.querySelector(".question-nav");
  if (!nav || !session) return;
  const results = session.status === "completed" ? calculateResults(session, questionMap) : null;
  const resultMap = results ? new Map(results.detail.map((item) => [item.number, item])) : null;
  nav.querySelectorAll("[data-position]").forEach((button) => {
    const position = Number(button.dataset.position);
    const number = Number(button.dataset.number);
    const status = navigatorStatus(number, resultMap);
    const current = position === session.currentIndex;
    button.className = `nav-number is-${status}${current ? " is-current" : ""}`;
    button.setAttribute("aria-label", navigatorLabel(position, status, current));
    if (current) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  });
  const summary = nav.querySelector("[data-nav-summary]");
  if (summary && !results) summary.innerHTML = `Đã trả lời: <strong>${answeredCount()}/${session.questionNumbers.length}</strong> câu`;
}

function closeQuestionNavigator() {
  document.querySelector(".question-nav")?.classList.remove("is-open");
  document.querySelector(".nav-backdrop")?.classList.remove("is-open");
}

function jumpToQuestion(number) {
  const position = session.questionNumbers.indexOf(number);
  if (position < 0) return;
  session.currentIndex = position;
  saveSession(session);
  if (document.body.dataset.view === "results" && !document.querySelector(`#question-${number}`)) {
    resultFilter = "all";
    renderResults();
  }
  requestAnimationFrame(() => {
    document.querySelector(`#question-${number}`)?.scrollIntoView({ block: "start", behavior: "auto" });
    updateNavigatorState();
  });
  closeQuestionNavigator();
}

function renderOption(question, option, { reviewed, locked }) {
  const answer = answerFor(question.number);
  const selected = answer.includes(option.id);
  const correctOption = reviewed && question.correct.includes(option.id);
  const wrongOption = reviewed && selected && !question.correct.includes(option.id);
  const stateClass = correctOption
    ? "is-correct-option"
    : wrongOption
      ? "is-wrong-option"
      : selected
        ? "is-selected-option"
        : "";
  const marker = correctOption ? "✓" : wrongOption ? "×" : option.id;
  const inputType = question.type === "single" ? "radio" : "checkbox";
  const stateText = correctOption ? "Đáp án đúng" : wrongOption ? "Bạn chọn sai" : "";

  return `<label class="answer-option ${stateClass}">
    <input type="${inputType}" name="answer-${question.number}" value="${escapeHtml(option.id)}" ${selected ? "checked" : ""} ${locked ? "disabled" : ""} />
    <span class="option-marker" aria-hidden="true">${marker}</span>
    <span class="option-copy"><strong>${escapeHtml(option.id)}.</strong> ${escapeHtml(option.text)}</span>
    ${stateText ? `<span class="option-state">${stateText}</span>` : ""}
  </label>`;
}

function renderQuestionBlock(question, position, { forcedStatus = null, review = false } = {}) {
  const status = questionStatus(question.number, forcedStatus);
  const reviewed = review || Boolean(status);
  const locked = review || (session.mode === "instant" && reviewed);
  const answer = answerFor(question.number);
  const label = statusLabel(status);
  const options = question.options
    .map((option) => renderOption(question, option, { reviewed, locked }))
    .join("");
  const canCheck = session.mode === "instant" && question.type === "multiple" && !reviewed;

  return `<article class="question-block ${status ? `question-${status}` : ""}" id="question-${question.number}" data-question-index="${position}">
    <div class="question-band">
      <strong>Câu ${position + 1}</strong>
      ${label ? `<span class="question-status status-${status}" tabindex="-1"><i aria-hidden="true">${label.icon}</i>${label.text}</span>` : ""}
    </div>
    <div class="question-content">
      <span class="question-type">${question.type === "multiple" ? "Chọn nhiều đáp án" : "Chọn một đáp án"}</span>
      <h2 class="question-text">${escapeHtml(question.text)}</h2>
      ${question.type === "multiple" ? '<p class="question-hint">Chọn tất cả phương án đúng.</p>' : ""}
      <fieldset class="answer-list ${reviewed ? "is-reviewed" : "is-plain"}" aria-label="Các phương án trả lời">
        ${options}
      </fieldset>
      ${canCheck ? `<button class="primary-button check-button" type="button" data-action="check" data-number="${question.number}" ${answer.length === 0 ? "disabled" : ""}>Kiểm tra câu này</button>` : ""}
      ${status && session.mode === "instant" && !review ? `<p class="inline-feedback ${status === "correct" ? "is-correct" : "is-wrong"}" aria-live="polite"><span aria-hidden="true">${label.icon}</span>${status === "correct" ? "Bạn đã chọn đúng toàn bộ đáp án." : "Đáp án của bạn chưa chính xác. Các phương án đúng đã được đánh dấu màu xanh."}</p>` : ""}
    </div>
  </article>`;
}

function answeredCount() {
  return session.questionNumbers.filter((number) => isAnswered(answerFor(number))).length;
}

function checkedCount() {
  return Object.keys(session.checked).length;
}

function renderExamHeader() {
  const answered = answeredCount();
  return `<header class="exam-toolbar">
    <div class="exam-toolbar-main">
      <p class="exam-title">Bài ôn tập: <strong>${modeLabel(session.mode)} · ${session.questionNumbers.length} câu</strong></p>
      <div class="exam-toolbar-actions">
        <button class="secondary-button mobile-nav-toggle mobile-only" type="button" data-action="nav-toggle">Danh sách câu</button>
        <button class="primary-button exam-submit-button" type="button" data-action="finish">${session.mode === "instant" ? "Kết thúc" : "Nộp bài"}</button>
      </div>
    </div>
    <div class="exam-progress-row" aria-live="polite">
      <span data-progress-label>${answered}/${session.questionNumbers.length} câu đã trả lời${session.mode === "instant" ? ` · ${checkedCount()} đã kiểm tra` : ""}</span>
      <progress data-answer-progress value="${answered}" max="${session.questionNumbers.length}">${answered}/${session.questionNumbers.length}</progress>
    </div>
  </header>`;
}

function renderExamFooter() {
  return `<footer class="exam-footer">
    <button class="exam-home-button" type="button" data-action="home" aria-label="Trở về trang bắt đầu" title="Trở về trang bắt đầu"><span aria-hidden="true">☰</span></button>
    <span class="exam-page-indicator" aria-label="Vị trí câu hỏi"><b data-current-question>${session.currentIndex + 1}</b><i>/ ${session.questionNumbers.length}</i></span>
    <span aria-hidden="true"></span>
  </footer>`;
}

function renderFinishPanel() {
  return `<footer class="finish-panel">
    <div><strong>Bạn đã đến cuối danh sách.</strong><span>Kiểm tra lại các câu phía trên trước khi hoàn tất.</span></div>
    <button class="primary-button" type="button" data-action="finish">${session.mode === "instant" ? "Kết thúc lượt ôn" : "Nộp bài"}</button>
  </footer>`;
}

function renderFinishDialog() {
  return `<dialog class="confirm-dialog" id="finish-dialog" aria-labelledby="finish-title">
    <form method="dialog">
      <span class="dialog-icon" aria-hidden="true">!</span>
      <h2 id="finish-title">Bạn còn câu chưa trả lời</h2>
      <p id="finish-message"></p>
      <div class="dialog-actions">
        <button class="secondary-button" value="cancel">Quay lại làm bài</button>
        <button class="primary-button" value="confirm" data-action="confirm-finish">Vẫn ${session.mode === "instant" ? "kết thúc" : "nộp bài"}</button>
      </div>
    </form>
  </dialog>`;
}

function installScrollTracking() {
  stopScrollTracking();
  scrollListener = () => {
    if (scrollFrame || !session) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = null;
      const blocks = [...document.querySelectorAll(".question-block")];
      let visibleIndex = 0;
      for (const block of blocks) {
        if (block.getBoundingClientRect().top <= 180) visibleIndex = Number(block.dataset.questionIndex);
        else break;
      }
      if (visibleIndex !== session.currentIndex) {
        session.currentIndex = visibleIndex;
        saveSession(session);
      }
      const currentLabel = document.querySelector("[data-current-question]");
      if (currentLabel) currentLabel.textContent = String(visibleIndex + 1);
      updateNavigatorState();
    });
  };
  window.addEventListener("scroll", scrollListener, { passive: true });
}

function renderQuiz({ restorePosition = false } = {}) {
  if (session.status === "completed") return renderResults();
  document.body.dataset.view = "exam";
  delete document.body.dataset.resultMode;
  const blocks = session.questionNumbers
    .map((number, index) => renderQuestionBlock(questionMap.get(number), index))
    .join("");
  app.className = "exam-app-shell";
  app.innerHTML = `<section class="exam-screen" aria-label="Bài ôn tập">
    ${renderExamHeader()}
    <div class="exam-workspace">
      <div class="exam-main-column"><main class="exam-list">${blocks}</main>${renderFinishPanel()}</div>
      ${renderQuestionNavigator()}
    </div>
  </section>${renderExamFooter()}${renderNavBackdrop()}${renderFinishDialog()}`;
  installScrollTracking();
  if (restorePosition && session.currentIndex > 0) {
    requestAnimationFrame(() => {
      const number = session.questionNumbers[session.currentIndex];
      document.querySelector(`#question-${number}`)?.scrollIntoView({ block: "start" });
    });
  }
}

function renderResults() {
  stopScrollTracking();
  document.body.dataset.view = "results";
  document.body.dataset.resultMode = session.mode;
  const results = calculateResults(session, questionMap);
  const filtered = resultFilter === "all"
    ? results.detail
    : results.detail.filter((item) => item.status === resultFilter);
  const labels = {
    all: `Tất cả (${results.total})`,
    correct: `Đúng (${results.correct})`,
    wrong: `Sai (${results.wrong})`,
    blank: `Bỏ trống (${results.blank})`,
  };
  const blocks = filtered
    .map((item) => {
      const position = session.questionNumbers.indexOf(item.number);
      return renderQuestionBlock(item.question, position, { forcedStatus: item.status, review: true });
    })
    .join("");

  app.className = "results-app-shell";
  if (session.mode === "submit") {
    app.innerHTML = `<section class="results-screen results-submit cls-review-results" aria-labelledby="results-title">
      <h1 class="visually-hidden" id="results-title">Kết quả bài thi ${results.score.toFixed(2)} trên 100 điểm</h1>
      <div class="cls-review-layout">
        <main class="cls-review-main">
          <header class="cls-review-topbar">
            <button class="text-button" type="button" data-action="discard"><span aria-hidden="true">←</span> Lượt ôn mới</button>
            <p>Kết quả bài thi: <strong>${results.correct}/${results.total} câu đúng</strong></p>
            <button class="secondary-button mobile-nav-toggle mobile-only" type="button" data-action="nav-toggle">Danh sách câu</button>
          </header>
          <div class="cls-filter-row">
            <div class="filter-tabs" role="group" aria-label="Lọc kết quả">
              ${Object.entries(labels).map(([key, label]) => `<button type="button" data-action="filter" data-filter="${key}" class="${resultFilter === key ? "is-active" : ""}" aria-pressed="${resultFilter === key}">${label}</button>`).join("")}
            </div>
          </div>
          <div class="exam-list review-exam-list">${blocks || '<div class="empty-state">Không có câu nào trong nhóm này.</div>'}</div>
        </main>
        ${renderQuestionNavigator(results)}
      </div>
      ${renderNavBackdrop()}
    </section>`;
    installScrollTracking();
    return;
  }
  app.innerHTML = `<section class="results-screen results-${session.mode}" aria-labelledby="results-title">
    <div class="results-topbar">
      <button class="text-button" type="button" data-action="discard"><span aria-hidden="true">←</span> Lượt ôn mới</button>
      <span>${modeLabel(session.mode)}</span>
    </div>
    <header class="results-hero">
      <div>
        <p class="eyebrow">Kết quả lượt ôn</p>
        <h1 id="results-title">${results.score.toFixed(2)}<small>/100 điểm</small></h1>
        <p>${results.correct === results.total ? "Xuất sắc — bạn đã trả lời đúng toàn bộ câu hỏi." : "Cuộn xuống để xem lựa chọn sai màu đỏ và đáp án đúng màu xanh."}</p>
      </div>
      <div class="result-stats">
        <div><strong>${results.correct}</strong><span>Đúng</span></div>
        <div><strong>${results.wrong}</strong><span>Sai</span></div>
        <div><strong>${results.blank}</strong><span>Bỏ trống</span></div>
      </div>
    </header>

    <div class="retry-actions">
      ${results.wrong ? `<button class="secondary-button" type="button" data-action="retry" data-kind="wrong">Ôn lại ${results.wrong} câu sai</button>` : ""}
      ${results.blank ? `<button class="secondary-button" type="button" data-action="retry" data-kind="blank">Làm ${results.blank} câu bỏ trống</button>` : ""}
    </div>

    <section class="review-section" aria-labelledby="review-title">
      <div class="review-header">
        <div><p class="eyebrow">Chi tiết</p><h2 id="review-title">Xem lại đáp án</h2></div>
        <div class="filter-tabs" role="group" aria-label="Lọc kết quả">
          ${Object.entries(labels).map(([key, label]) => `<button type="button" data-action="filter" data-filter="${key}" class="${resultFilter === key ? "is-active" : ""}" aria-pressed="${resultFilter === key}">${label}</button>`).join("")}
        </div>
      </div>
      <div class="exam-list review-exam-list">${blocks || '<div class="empty-state">Không có câu nào trong nhóm này.</div>'}</div>
    </section>
  </section>`;
}

function updateProgress() {
  const answered = answeredCount();
  const label = document.querySelector("[data-progress-label]");
  const progress = document.querySelector("[data-answer-progress]");
  if (label) label.textContent = `${answered}/${session.questionNumbers.length} câu đã trả lời${session.mode === "instant" ? ` · ${checkedCount()} đã kiểm tra` : ""}`;
  if (progress) progress.value = answered;
  updateNavigatorState();
}

function replaceQuestionBlock(number) {
  const position = session.questionNumbers.indexOf(number);
  const block = document.querySelector(`#question-${number}`);
  if (!block) return;
  block.outerHTML = renderQuestionBlock(questionMap.get(number), position);
  updateProgress();
}

function startSession({ mode, count, order }) {
  session = createSession(chooseQuestionNumbers(questions, count, order), mode);
  resultFilter = "all";
  saveSession(session);
  renderQuiz();
  window.scrollTo({ top: 0, behavior: "auto" });
  app.focus();
}

function startSessionFromNumbers(numbers) {
  session = createSession(numbers, session?.mode ?? "submit");
  resultFilter = "all";
  saveSession(session);
  renderQuiz();
  window.scrollTo({ top: 0, behavior: "auto" });
  app.focus();
}

function finishSession() {
  session.status = "completed";
  session.completedAt = new Date().toISOString();
  for (const number of session.questionNumbers) {
    const answer = answerFor(number);
    if (isAnswered(answer)) session.checked[String(number)] = isCorrect(questionMap.get(number), answer);
  }
  saveSession(session);
  resultFilter = "all";
  renderResults();
  window.scrollTo({ top: 0, behavior: "auto" });
  app.focus();
}

function requestFinish() {
  const blankCount = session.questionNumbers.filter((number) => !isAnswered(answerFor(number))).length;
  if (!blankCount) return finishSession();
  document.querySelector("#finish-message").textContent = `Bạn còn ${blankCount} câu chưa trả lời. Các câu này sẽ được tính là bỏ trống.`;
  document.querySelector("#finish-dialog").showModal();
}

function handleAnswerChange(input) {
  const number = Number(input.name.replace("answer-", ""));
  const question = questionMap.get(number);
  const key = String(number);
  if (!question || (session.mode === "instant" && Object.hasOwn(session.checked, key))) return;

  session.currentIndex = session.questionNumbers.indexOf(number);
  if (question.type === "single") {
    session.answers[key] = [input.value];
    if (session.mode === "instant") session.checked[key] = isCorrect(question, [input.value]);
  } else {
    const selected = [...document.querySelectorAll(`input[name="answer-${number}"]:checked`)].map((element) => element.value);
    session.answers[key] = question.options.map((option) => option.id).filter((id) => selected.includes(id));
  }
  saveSession(session);

  if (session.mode === "instant" && question.type === "single") {
    replaceQuestionBlock(number);
    document.querySelector(`#question-${number} .question-status`)?.focus();
  } else {
    const checkButton = document.querySelector(`[data-action="check"][data-number="${number}"]`);
    if (checkButton) checkButton.disabled = !isAnswered(session.answers[key]);
    updateProgress();
  }
}

function gradeQuestion(number) {
  const answer = answerFor(number);
  if (!isAnswered(answer)) return;
  session.currentIndex = session.questionNumbers.indexOf(number);
  session.checked[String(number)] = isCorrect(questionMap.get(number), answer);
  saveSession(session);
  replaceQuestionBlock(number);
  document.querySelector(`#question-${number} .question-status`)?.focus();
}

function registerWebMcpTool() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const allowedCounts = ["20", "50", "100", "all"];
  try {
    void Promise.resolve(context.registerTool({
      name: "start_practice_session",
      title: "Bắt đầu lượt ôn tập",
      description: "Bắt đầu một lượt ôn tập Vietbank mới với số câu, chế độ và thứ tự được chọn.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["submit", "instant"] },
          count: { type: "string", enum: allowedCounts },
          order: { type: "string", enum: ["random", "original"] },
        },
        required: ["mode", "count", "order"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || !["submit", "instant"].includes(input.mode) || !allowedCounts.includes(input.count) || !["random", "original"].includes(input.order)) throw new Error("Cấu hình lượt ôn không hợp lệ.");
        startSession(input);
        return { status: "started", total: session.questionNumbers.length, mode: session.mode };
      },
    })).catch(() => {});
  } catch {
    // Trình duyệt chưa hỗ trợ WebMCP; giao diện vẫn hoạt động bình thường.
  }
}

app.addEventListener("submit", (event) => {
  if (event.target.id !== "setup-form") return;
  event.preventDefault();
  const formData = new FormData(event.target);
  startSession({ mode: formData.get("mode"), count: formData.get("count"), order: formData.get("order") });
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name === "mode") {
    document.querySelectorAll(".choice-card").forEach((card) => {
      card.classList.toggle("is-selected", card.querySelector("input")?.checked === true);
    });
  } else if (target.name.startsWith("answer-")) {
    handleAnswerChange(target);
  }
});

app.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "jump") {
    jumpToQuestion(Number(button.dataset.number));
  } else if (action === "nav-toggle") {
    document.querySelector(".question-nav")?.classList.add("is-open");
    document.querySelector(".nav-backdrop")?.classList.add("is-open");
    document.querySelector(".question-nav .nav-number.is-current")?.focus();
  } else if (action === "nav-close") {
    closeQuestionNavigator();
    document.querySelector("[data-action='nav-toggle']")?.focus();
  } else if (action === "resume") {
    session.status === "completed" ? renderResults() : renderQuiz({ restorePosition: true });
    app.focus();
  } else if (action === "discard") {
    clearSession();
    session = null;
    restoreNotice = "";
    renderStart();
    window.scrollTo({ top: 0, behavior: "auto" });
    app.focus();
  } else if (action === "home") {
    renderStart();
    window.scrollTo({ top: 0, behavior: "auto" });
    app.focus();
  } else if (action === "check") {
    gradeQuestion(Number(button.dataset.number));
  } else if (action === "finish") {
    requestFinish();
  } else if (action === "confirm-finish") {
    finishSession();
  } else if (action === "filter") {
    resultFilter = button.dataset.filter;
    renderResults();
    document.querySelector(`[data-filter="${resultFilter}"]`)?.focus();
  } else if (action === "retry") {
    const results = calculateResults(session, questionMap);
    startSessionFromNumbers(results.detail.filter((item) => item.status === button.dataset.kind).map((item) => item.number));
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.querySelector(".question-nav.is-open")) {
    closeQuestionNavigator();
    document.querySelector("[data-action='nav-toggle']")?.focus();
  }
});

async function init() {
  try {
    const response = await fetch(new URL("../data/questions.json", import.meta.url));
    if (!response.ok) throw new Error("Không tải được bộ câu hỏi.");
    const data = await response.json();
    questions = data.questions;
    questionMap = new Map(questions.map((question) => [question.number, question]));
    const restored = loadSession(questions);
    session = restored.session;
    restoreNotice = restored.error ? `${restored.error} Bạn có thể bắt đầu một lượt mới.` : "";
    renderStart();
    registerWebMcpTool();
  } catch (error) {
    document.body.dataset.view = "start";
    app.className = "app-shell";
    app.innerHTML = `<div class="load-error" role="alert"><strong>Chưa thể mở bộ câu hỏi</strong><p>${escapeHtml(error.message)}</p><button class="primary-button" type="button" onclick="location.reload()">Thử tải lại</button></div>`;
  }
}

init();
