import { loadAppConfig, validateConfig } from "../../src/config.js";
import { AgentLLMCaller, AGENT_STATE } from "./agent-llm-caller.js";

const PIPELINE_STORAGE_KEY = "ai8.lesson13.pipeline";

const PIPELINE_STATES = {
  idle: "IDLE",
  planning: "PLANNING",
  review: "REVIEW",
  executing: "EXECUTING",
  validating: "VALIDATING",
  completed: "COMPLETED",
  paused: "PAUSED",
  error: "ERROR"
};

const STAGES = {
  planner: "planner",
  executor: "executor",
  validator: "validator"
};

const STAGE_LABELS = {
  [STAGES.planner]: "Planner",
  [STAGES.executor]: "Executor",
  [STAGES.validator]: "Validator"
};

const STAGE_STATES = {
  [STAGES.planner]: PIPELINE_STATES.planning,
  [STAGES.executor]: PIPELINE_STATES.executing,
  [STAGES.validator]: PIPELINE_STATES.validating
};

const STAGE_RESULT_KEYS = {
  [STAGES.planner]: "plan",
  [STAGES.executor]: "execution",
  [STAGES.validator]: "validation"
};

const NEXT_STAGE = {
  [STAGES.planner]: STAGES.executor,
  [STAGES.executor]: STAGES.validator,
  [STAGES.validator]: null
};

const STAGE_ORDER = [
  PIPELINE_STATES.idle,
  PIPELINE_STATES.planning,
  PIPELINE_STATES.review,
  PIPELINE_STATES.executing,
  PIPELINE_STATES.validating,
  PIPELINE_STATES.completed
];

const SYSTEM_PROMPTS = {
  coordinator: `Ты координатор.

Твоя задача:
- запускать этапы процесса;
- передавать данные между агентами;
- хранить состояние процесса;
- управлять переходами между этапами;
- останавливать workflow в состоянии REVIEW до решения пользователя.

Coordinator не должен генерировать основной ответ пользователю.
Он управляет пайплайном.`,
  planner: `Ты специалист по анализу задач.

Твоя задача:
- понять запрос пользователя;
- выявить требования;
- определить ограничения;
- составить понятный план действий;
- не выполнять задачу самостоятельно.

На выходе выдай структурированный план выполнения.`,
  executor: `Ты исполнитель задач.

Твоя задача:
- получить план;
- выполнить его максимально качественно;
- сгенерировать результат;
- не заниматься проверкой качества.`,
  validator: `Ты валидатор результата.

Проверь:
- соответствие исходной задаче;
- полноту;
- логические ошибки;
- пропущенные требования.

Сформируй отчет о проверке.`
};

const form = document.querySelector("#lesson-form");
const taskInput = document.querySelector("#task-input");
const startButton = document.querySelector("#start-button");
const pauseButton = document.querySelector("#pause-button");
const resumeButton = document.querySelector("#resume-button");
const clearFlowButton = document.querySelector("#clear-flow-button");
const sendFeedbackButton = document.querySelector("#send-feedback-button");
const approveContinueButton = document.querySelector("#approve-continue-button");
const reviewActions = document.querySelector("#review-actions");
const reviewTitle = document.querySelector("#review-title");
const reviewStageLabel = document.querySelector("#review-stage-label");
const reviewOutput = document.querySelector("#review-output");
const reviewFeedbackInput = document.querySelector("#review-feedback-input");
const pipelineStateBadge = document.querySelector("#pipeline-state-badge");
const configError = document.querySelector("#config-error");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const pipelineStatusMessage = document.querySelector("#pipeline-status-message");
const currentStateLabel = document.querySelector("#current-state-label");
const completedStepsLabel = document.querySelector("#completed-steps-label");
const nextStepLabel = document.querySelector("#next-step-label");
const coordinatorStateLabel = document.querySelector("#coordinator-state-label");
const coordinatorSummary = document.querySelector("#coordinator-summary");
const plannerStateLabel = document.querySelector("#planner-state-label");
const plannerSummary = document.querySelector("#planner-summary");
const executorStateLabel = document.querySelector("#executor-state-label");
const executorSummary = document.querySelector("#executor-summary");
const validatorStateLabel = document.querySelector("#validator-state-label");
const validatorSummary = document.querySelector("#validator-summary");
const finalResultOutput = document.querySelector("#final-result-output");
const agentHistoryDialog = document.querySelector("#agent-history-dialog");
const agentDialogEyebrow = document.querySelector("#agent-dialog-eyebrow");
const agentDialogTitle = document.querySelector("#agent-dialog-title");
const agentDialogState = document.querySelector("#agent-dialog-state");
const agentDialogServiceState = document.querySelector("#agent-dialog-service-state");
const agentDialogPrompt = document.querySelector("#agent-dialog-prompt");
const agentHistoryList = document.querySelector("#agent-history-list");
const clearAgentHistoryButton = document.querySelector("#clear-agent-history-button");
const closeAgentHistoryButton = document.querySelector("#close-agent-history-button");
const agentHistoryButtons = document.querySelectorAll(".agent-history-button");
const agentClearButtons = document.querySelectorAll(".agent-clear-button");
const stateNodes = document.querySelectorAll(".state-node");
const agentCards = document.querySelectorAll("[data-agent-card]");

const requiredElements = [
  form,
  taskInput,
  startButton,
  pauseButton,
  resumeButton,
  clearFlowButton,
  sendFeedbackButton,
  approveContinueButton,
  reviewActions,
  reviewTitle,
  reviewStageLabel,
  reviewOutput,
  reviewFeedbackInput,
  pipelineStateBadge,
  configError,
  endpointLabel,
  modelLabel,
  pipelineStatusMessage,
  currentStateLabel,
  completedStepsLabel,
  nextStepLabel,
  coordinatorStateLabel,
  coordinatorSummary,
  plannerStateLabel,
  plannerSummary,
  executorStateLabel,
  executorSummary,
  validatorStateLabel,
  validatorSummary,
  finalResultOutput,
  agentHistoryDialog,
  agentDialogEyebrow,
  agentDialogTitle,
  agentDialogState,
  agentDialogServiceState,
  agentDialogPrompt,
  agentHistoryList,
  clearAgentHistoryButton,
  closeAgentHistoryButton
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 13 page is missing required DOM elements.");
}

let activeConfig = null;
let agents = {};
let pipelineState = PIPELINE_STATES.idle;
let previousPipelineState = PIPELINE_STATES.idle;
let pauseRequested = false;
let pipelineData = createInitialPipelineData();
let activeDialogAgentKey = null;

function createInitialPipelineData() {
  return {
    task: "",
    currentStage: null,
    plan: "",
    execution: "",
    validation: "",
    finalResult: "",
    completedSteps: [],
    reviewStage: null,
    reviewContent: "Запустите Planner, чтобы получить первый результат для ревью."
  };
}

function createAgents(config) {
  return {
    coordinator: new AgentLLMCaller({
      name: "Coordinator",
      apiEndpoint: config.apiEndpoint,
      model: config.model,
      systemPrompt: SYSTEM_PROMPTS.coordinator
    }),
    planner: new AgentLLMCaller({
      name: "Planner",
      apiEndpoint: config.apiEndpoint,
      model: config.model,
      systemPrompt: SYSTEM_PROMPTS.planner
    }),
    executor: new AgentLLMCaller({
      name: "Executor",
      apiEndpoint: config.apiEndpoint,
      model: config.model,
      systemPrompt: SYSTEM_PROMPTS.executor
    }),
    validator: new AgentLLMCaller({
      name: "Validator",
      apiEndpoint: config.apiEndpoint,
      model: config.model,
      systemPrompt: SYSTEM_PROMPTS.validator
    })
  };
}

function showConfig(config) {
  endpointLabel.textContent = config.apiEndpoint || "not set";
  modelLabel.textContent = config.model || "not set";
}

function showConfigError(message) {
  configError.hidden = false;
  configError.textContent = message;
}

function clearConfigError() {
  configError.hidden = true;
  configError.textContent = "";
}

function setPipelineState(state, message = "") {
  pipelineState = state;
  pipelineStateBadge.textContent = state;
  currentStateLabel.textContent = state;
  pipelineStateBadge.className = `status-badge ${
    state === PIPELINE_STATES.error
      ? "status-error"
      : state === PIPELINE_STATES.completed
        ? "status-success"
        : state === PIPELINE_STATES.paused || state === PIPELINE_STATES.idle
          ? "status-idle"
          : "status-loading"
  }`;

  if (message) {
    pipelineStatusMessage.textContent = message;
  }

  renderStateMachine();
  renderControls();
}

function setCoordinatorSummary(message) {
  coordinatorSummary.textContent = message;
}

function serializePipeline() {
  return {
    pipelineState,
    previousPipelineState,
    pauseRequested,
    pipelineData,
    agents: Object.fromEntries(
      Object.entries(agents).map(([key, agent]) => [key, agent.serializeState()])
    )
  };
}

function savePipelineState() {
  localStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(serializePipeline()));
}

function restorePipelineState() {
  try {
    const rawValue = localStorage.getItem(PIPELINE_STORAGE_KEY);
    if (!rawValue) {
      return false;
    }

    const snapshot = JSON.parse(rawValue);
    pipelineState = typeof snapshot.pipelineState === "string" ? snapshot.pipelineState : PIPELINE_STATES.idle;
    previousPipelineState =
      typeof snapshot.previousPipelineState === "string" ? snapshot.previousPipelineState : PIPELINE_STATES.idle;
    pauseRequested = snapshot.pauseRequested === true;
    pipelineData = snapshot.pipelineData && typeof snapshot.pipelineData === "object"
      ? {
          task: typeof snapshot.pipelineData.task === "string" ? snapshot.pipelineData.task : "",
          currentStage: typeof snapshot.pipelineData.currentStage === "string"
            ? snapshot.pipelineData.currentStage
            : null,
          plan: typeof snapshot.pipelineData.plan === "string" ? snapshot.pipelineData.plan : "",
          execution: typeof snapshot.pipelineData.execution === "string" ? snapshot.pipelineData.execution : "",
          validation: typeof snapshot.pipelineData.validation === "string" ? snapshot.pipelineData.validation : "",
          finalResult: typeof snapshot.pipelineData.finalResult === "string" ? snapshot.pipelineData.finalResult : "",
          completedSteps: Array.isArray(snapshot.pipelineData.completedSteps) ? snapshot.pipelineData.completedSteps : [],
          reviewStage: typeof snapshot.pipelineData.reviewStage === "string" ? snapshot.pipelineData.reviewStage : null,
          reviewContent: typeof snapshot.pipelineData.reviewContent === "string"
            ? snapshot.pipelineData.reviewContent
            : createInitialPipelineData().reviewContent
        }
      : createInitialPipelineData();

    if (snapshot.agents && typeof snapshot.agents === "object") {
      for (const [key, agent] of Object.entries(agents)) {
        agent.restoreState(snapshot.agents[key]);
      }
    }

    return true;
  } catch {
    return false;
  }
}

function clearPipelineState() {
  localStorage.removeItem(PIPELINE_STORAGE_KEY);
}

function summarizeText(text, fallback) {
  if (!text) {
    return fallback;
  }

  const normalized = text.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
}

function getAgentSummary(agentKey) {
  const agent = agents[agentKey];
  const baseStatus = `Status: ${agent.getStateLabel()}.`;

  if (agent.lastError) {
    return `${baseStatus} Ошибка: ${summarizeText(agent.lastError, "")}`;
  }

  if (agent.lastOutput) {
    return `${baseStatus} ${summarizeText(agent.lastOutput, `${agent.name} завершил шаг.`)}`;
  }

  return `${baseStatus} ${agent.name} ещё не запускался.`;
}

function syncTaskFromInput() {
  pipelineData.task = taskInput.value.trim();
}

function clearReviewInput() {
  reviewFeedbackInput.value = "";
}

function markStepCompleted(state) {
  if (!pipelineData.completedSteps.includes(state)) {
    pipelineData.completedSteps.push(state);
  }
}

function removeCompletedSteps(states) {
  const blockedStates = new Set(states);
  pipelineData.completedSteps = pipelineData.completedSteps.filter((state) => !blockedStates.has(state));
}

function getReviewStageLabel() {
  if (!pipelineData.reviewStage) {
    return "не выбран";
  }

  return STAGE_LABELS[pipelineData.reviewStage] || pipelineData.reviewStage;
}

function getNextStateLabel() {
  if (pipelineState === PIPELINE_STATES.review) {
    const nextStage = pipelineData.currentStage ? NEXT_STAGE[pipelineData.currentStage] : null;
    return nextStage ? STAGE_STATES[nextStage] : PIPELINE_STATES.completed;
  }

  const currentIndex = STAGE_ORDER.indexOf(pipelineState);
  if (currentIndex === -1) {
    return STAGE_ORDER[0];
  }

  return STAGE_ORDER[currentIndex + 1] ?? "нет";
}

function renderControls() {
  const isRunning = [PIPELINE_STATES.planning, PIPELINE_STATES.executing, PIPELINE_STATES.validating].includes(
    pipelineState
  );

  startButton.disabled = isRunning;
  pauseButton.disabled = !(isRunning || pipelineState === PIPELINE_STATES.review || pipelineState === PIPELINE_STATES.paused);
  resumeButton.disabled = pipelineState !== PIPELINE_STATES.paused;
  clearFlowButton.disabled = isRunning;

  sendFeedbackButton.disabled = pipelineState !== PIPELINE_STATES.review;
  approveContinueButton.disabled = pipelineState !== PIPELINE_STATES.review;
  reviewFeedbackInput.disabled = pipelineState !== PIPELINE_STATES.review;
  reviewActions.hidden = pipelineState !== PIPELINE_STATES.review;

  agentClearButtons.forEach((button) => {
    const agentKey = button.dataset.agent;
    if (!agentKey || !agents[agentKey]) {
      button.disabled = true;
      return;
    }

    button.disabled = agents[agentKey].getStateLabel() === AGENT_STATE.running;
  });

  if (activeDialogAgentKey && agents[activeDialogAgentKey]) {
    clearAgentHistoryButton.disabled = agents[activeDialogAgentKey].getStateLabel() === AGENT_STATE.running;
  } else {
    clearAgentHistoryButton.disabled = true;
  }
}

function renderStateMachine() {
  const nextState = getNextStateLabel();
  completedStepsLabel.textContent =
    pipelineData.completedSteps.length > 0 ? pipelineData.completedSteps.join(", ") : "нет";
  nextStepLabel.textContent = nextState;

  stateNodes.forEach((node) => {
    const nodeState = node.dataset.state || "";
    node.classList.remove("state-node-active", "state-node-completed", "state-node-next", "state-node-waiting");

    if (nodeState === pipelineState) {
      if (nodeState === PIPELINE_STATES.review) {
        node.classList.add("state-node-waiting");
      } else {
        node.classList.add("state-node-active");
      }
      return;
    }

    if (pipelineData.completedSteps.includes(nodeState)) {
      node.classList.add("state-node-completed");
      return;
    }

    if (nodeState === nextState) {
      node.classList.add("state-node-next");
    }
  });

  agentCards.forEach((card) => {
    const agentName = card.dataset.agentCard;
    card.classList.remove("agent-card-active", "agent-card-completed", "agent-card-paused", "agent-card-error");
    const agentState = agents[agentName]?.getStateLabel();

    if (agentState === AGENT_STATE.running) {
      card.classList.add("agent-card-active");
    } else if (agentState === AGENT_STATE.completed) {
      card.classList.add("agent-card-completed");
    } else if (agentState === AGENT_STATE.paused) {
      card.classList.add("agent-card-paused");
    } else if (agentState === AGENT_STATE.error) {
      card.classList.add("agent-card-error");
    }
  });
}

function renderPipelineUi() {
  coordinatorStateLabel.textContent = agents.coordinator.getStateLabel();
  plannerStateLabel.textContent = agents.planner.getStateLabel();
  executorStateLabel.textContent = agents.executor.getStateLabel();
  validatorStateLabel.textContent = agents.validator.getStateLabel();

  plannerSummary.textContent = getAgentSummary("planner");
  executorSummary.textContent = getAgentSummary("executor");
  validatorSummary.textContent = getAgentSummary("validator");

  reviewTitle.textContent = "Единый Review Block";
  reviewStageLabel.textContent = getReviewStageLabel();
  reviewOutput.textContent = pipelineData.reviewContent;
  finalResultOutput.textContent = pipelineData.finalResult || "Итоговый результат появится здесь.";

  renderStateMachine();
  renderControls();
}

function renderAgentDialog(agentKey) {
  const agent = agents[agentKey];
  activeDialogAgentKey = agentKey;
  agentDialogEyebrow.textContent = agent.name;
  agentDialogTitle.textContent = `История агента ${agent.name}`;
  agentDialogState.textContent = agent.getStateLabel();
  agentDialogPrompt.textContent = agent.systemPrompt;
  agentDialogServiceState.textContent = JSON.stringify(
    {
      state: agent.getStateLabel(),
      lastOutput: agent.lastOutput,
      lastError: agent.lastError
    },
    null,
    2
  );

  const history = agent.getHistory();
  if (history.length === 0) {
    agentHistoryList.innerHTML = '<p class="history-empty">История пока пуста.</p>';
    renderControls();
    return;
  }

  agentHistoryList.innerHTML = history
    .map((message) => {
      const label =
        message.role === "user"
          ? "User"
          : message.role === "assistant"
            ? "Assistant"
            : message.role === "reviewer"
              ? "Reviewer"
              : message.role;

      return `
        <article class="history-entry history-entry-${message.role}">
          <p class="history-entry-role">${label}</p>
          <p class="history-entry-content">${escapeHtml(message.content)}</p>
        </article>
      `;
    })
    .join("");

  renderControls();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildCoordinatorPrompt(stage, payload) {
  return JSON.stringify({
    stage,
    pipelineState,
    currentStage: pipelineData.currentStage,
    task: pipelineData.task,
    plan: pipelineData.plan,
    execution: pipelineData.execution,
    validation: pipelineData.validation,
    payload
  });
}

function pauseAllAgents() {
  Object.values(agents).forEach((agent) => {
    agent.pause();
  });
}

function resumeAllAgents() {
  Object.values(agents).forEach((agent) => {
    agent.resume();
  });
}

function requestPause() {
  if (pipelineState === PIPELINE_STATES.paused) {
    return;
  }

  if ([PIPELINE_STATES.planning, PIPELINE_STATES.executing, PIPELINE_STATES.validating].includes(pipelineState)) {
    pauseRequested = true;
    previousPipelineState = pipelineState;
    setCoordinatorSummary("Пауза запрошена. Координатор остановит workflow после завершения текущего шага.");
    pipelineStatusMessage.textContent = "Пауза будет применена после завершения текущего этапа.";
    savePipelineState();
    renderPipelineUi();
    return;
  }

  previousPipelineState = pipelineState;
  pauseAllAgents();
  setPipelineState(PIPELINE_STATES.paused, "Пайплайн поставлен на паузу.");
  setCoordinatorSummary("Пайплайн находится на паузе и ждёт Resume.");
  savePipelineState();
}

function finalizePause(resumeState, message) {
  pauseRequested = false;
  previousPipelineState = resumeState;
  pauseAllAgents();
  setPipelineState(PIPELINE_STATES.paused, message);
  setCoordinatorSummary("Координатор сохранил состояние и ожидает Resume.");
  savePipelineState();
}

function getStagePrompt(stage) {
  if (stage === STAGES.planner) {
    return pipelineData.task;
  }

  if (stage === STAGES.executor) {
    return `Исходная задача:\n${pipelineData.task}\n\nПлан:\n${pipelineData.plan}`;
  }

  return `Исходная задача:\n${pipelineData.task}\n\nРезультат Executor:\n${pipelineData.execution}`;
}

function getFeedbackPrompt(stage) {
  if (stage === STAGES.planner) {
    return `Исходная задача:\n${pipelineData.task}\n\nТвой предыдущий план и замечание ревьюера уже есть в истории. Подготовь обновлённый план с учетом замечания.`;
  }

  if (stage === STAGES.executor) {
    return `Исходная задача:\n${pipelineData.task}\n\nПлан:\n${pipelineData.plan}\n\nТвой предыдущий результат и замечание ревьюера уже есть в истории. Подготовь обновлённый результат.`;
  }

  return `Исходная задача:\n${pipelineData.task}\n\nРезультат Executor:\n${pipelineData.execution}\n\nТвой предыдущий отчёт и замечание ревьюера уже есть в истории. Подготовь обновлённую проверку.`;
}

async function transitionToReview(stage, output) {
  pipelineData.currentStage = stage;
  pipelineData.reviewStage = stage;
  pipelineData.reviewContent = output;
  clearReviewInput();
  renderPipelineUi();
  savePipelineState();

  if (pauseRequested) {
    finalizePause(PIPELINE_STATES.review, `Пайплайн поставлен на паузу после этапа ${STAGE_LABELS[stage]}.`);
    return;
  }

  setPipelineState(PIPELINE_STATES.review, `${STAGE_LABELS[stage]} завершил этап. Workflow ждёт review пользователя.`);
  savePipelineState();
}

async function runStage(stage, options = {}) {
  const isFeedbackRerun = options.isFeedbackRerun === true;
  const stageState = STAGE_STATES[stage];
  const stageLabel = STAGE_LABELS[stage];
  const agent = agents[stage];
  const resultKey = STAGE_RESULT_KEYS[stage];

  clearConfigError();
  pipelineData.currentStage = stage;

  if (stage === STAGES.executor) {
    agents.validator.reset();
    pipelineData.validation = "";
    pipelineData.finalResult = "";
    removeCompletedSteps([PIPELINE_STATES.validating, PIPELINE_STATES.completed]);
  }

  if (stage === STAGES.validator) {
    pipelineData.validation = "";
    pipelineData.finalResult = "";
    removeCompletedSteps([PIPELINE_STATES.validating, PIPELINE_STATES.completed]);
  }

  setPipelineState(stageState, `${stageLabel} выполняет текущий этап...`);
  await agents.coordinator.run(
    buildCoordinatorPrompt(stageState, isFeedbackRerun ? `Повторно запусти ${stageLabel} после feedback пользователя.` : `Запусти ${stageLabel} и передай результат в единый review.`)
  );
  setCoordinatorSummary(`Координатор запустил ${stageLabel} и подготовит единый review block после завершения.`);

  const result = await agent.run(isFeedbackRerun ? getFeedbackPrompt(stage) : getStagePrompt(stage));
  pipelineData[resultKey] = result.answer;

  if (stage === STAGES.validator) {
    pipelineData.finalResult = `Результат Executor:\n${pipelineData.execution}\n\nОтчёт Validator:\n${result.answer}`;
  }

  markStepCompleted(stageState);
  await transitionToReview(stage, result.answer);
}

async function approveAndContinue() {
  if (pipelineState !== PIPELINE_STATES.review || !pipelineData.currentStage) {
    return;
  }

  const currentStage = pipelineData.currentStage;
  const stageLabel = STAGE_LABELS[currentStage];
  const nextStage = NEXT_STAGE[currentStage];

  if (!nextStage) {
    await agents.coordinator.run(
      buildCoordinatorPrompt("approve-review", `Пользователь подтвердил review для ${stageLabel}. Заверши workflow.`)
    );
    markStepCompleted(PIPELINE_STATES.completed);
    pipelineData.reviewStage = currentStage;
    pipelineData.finalResult = `Результат Executor:\n${pipelineData.execution}\n\nОтчёт Validator:\n${pipelineData.validation}`;
    setCoordinatorSummary("Пользователь подтвердил финальный review. Workflow завершён.");
    setPipelineState(PIPELINE_STATES.completed, "Все этапы подтверждены пользователем. Workflow завершён.");
    savePipelineState();
    renderPipelineUi();
    return;
  }

  await agents.coordinator.run(
    buildCoordinatorPrompt("approve-review", `Пользователь подтвердил review для ${stageLabel}. Перейди к этапу ${STAGE_LABELS[nextStage]}.`)
  );
  setCoordinatorSummary(`Пользователь подтвердил ${stageLabel}. Coordinator запускает ${STAGE_LABELS[nextStage]}.`);
  savePipelineState();
  await runStage(nextStage);
}

async function sendFeedback() {
  if (pipelineState !== PIPELINE_STATES.review || !pipelineData.currentStage) {
    return;
  }

  const feedback = reviewFeedbackInput.value.trim();
  if (!feedback) {
    pipelineStatusMessage.textContent = "Введите feedback перед повторным запуском этапа.";
    return;
  }

  const stage = pipelineData.currentStage;
  const stageLabel = STAGE_LABELS[stage];

  clearConfigError();
  agents[stage].appendHistory("reviewer", feedback);
  await agents.coordinator.run(
    buildCoordinatorPrompt("review-feedback", `Пользователь отправил feedback для ${stageLabel}. Повтори этот этап.`)
  );
  setCoordinatorSummary(`Координатор получил feedback для ${stageLabel} и перезапускает этап.`);
  clearReviewInput();
  savePipelineState();
  await runStage(stage, { isFeedbackRerun: true });
}

function clearEntireFlow() {
  Object.values(agents).forEach((agent) => {
    agent.reset();
  });

  pipelineData = createInitialPipelineData();
  pauseRequested = false;
  previousPipelineState = PIPELINE_STATES.idle;
  taskInput.value = "";
  clearReviewInput();
  clearConfigError();
  setPipelineState(PIPELINE_STATES.idle, "Workflow очищен. Можно запускать новый сценарий.");
  setCoordinatorSummary("Координатор очистил сохранённый workflow и историю агентов.");
  clearPipelineState();

  if (agentHistoryDialog.open) {
    activeDialogAgentKey = null;
    agentHistoryDialog.close();
  }

  renderPipelineUi();
}

function setReviewFromNearestStage() {
  if (pipelineData.validation) {
    pipelineData.currentStage = STAGES.validator;
    pipelineData.reviewStage = STAGES.validator;
    pipelineData.reviewContent = pipelineData.validation;
    setPipelineState(PIPELINE_STATES.review, "Workflow вернулся к review этапа Validator.");
    return;
  }

  if (pipelineData.execution) {
    pipelineData.currentStage = STAGES.executor;
    pipelineData.reviewStage = STAGES.executor;
    pipelineData.reviewContent = pipelineData.execution;
    setPipelineState(PIPELINE_STATES.review, "Workflow вернулся к review этапа Executor.");
    return;
  }

  if (pipelineData.plan) {
    pipelineData.currentStage = STAGES.planner;
    pipelineData.reviewStage = STAGES.planner;
    pipelineData.reviewContent = pipelineData.plan;
    setPipelineState(PIPELINE_STATES.review, "Workflow вернулся к review этапа Planner.");
    return;
  }

  pipelineData.currentStage = null;
  pipelineData.reviewStage = null;
  pipelineData.reviewContent = createInitialPipelineData().reviewContent;
  setPipelineState(PIPELINE_STATES.idle, "Workflow возвращён к начальному состоянию.");
}

function clearAgentState(agentKey) {
  const agent = agents[agentKey];
  if (!agent || agent.getStateLabel() === AGENT_STATE.running) {
    return;
  }

  agent.reset();
  pauseRequested = false;

  if (agentKey === "planner") {
    agents.executor.reset();
    agents.validator.reset();
    syncTaskFromInput();
    pipelineData.plan = "";
    pipelineData.execution = "";
    pipelineData.validation = "";
    pipelineData.finalResult = "";
    removeCompletedSteps([
      PIPELINE_STATES.planning,
      PIPELINE_STATES.executing,
      PIPELINE_STATES.validating,
      PIPELINE_STATES.completed
    ]);
    setCoordinatorSummary("Координатор сбросил Planner и зависимые этапы.");
    setReviewFromNearestStage();
  } else if (agentKey === "executor") {
    agents.validator.reset();
    pipelineData.execution = "";
    pipelineData.validation = "";
    pipelineData.finalResult = "";
    removeCompletedSteps([
      PIPELINE_STATES.executing,
      PIPELINE_STATES.validating,
      PIPELINE_STATES.completed
    ]);
    setCoordinatorSummary("Координатор сбросил Executor и зависимый Validator.");
    setReviewFromNearestStage();
  } else if (agentKey === "validator") {
    pipelineData.validation = "";
    pipelineData.finalResult = "";
    removeCompletedSteps([PIPELINE_STATES.validating, PIPELINE_STATES.completed]);
    setCoordinatorSummary("Координатор сбросил Validator.");
    setReviewFromNearestStage();
  } else if (agentKey === "coordinator") {
    setCoordinatorSummary("История Coordinator очищена. Текущее состояние workflow сохранено.");
  }

  clearReviewInput();

  if (agentHistoryDialog.open && activeDialogAgentKey === agentKey) {
    renderAgentDialog(agentKey);
  }

  savePipelineState();
  renderPipelineUi();
}

function resetPipeline(task) {
  Object.values(agents).forEach((agent) => {
    agent.reset();
  });

  pipelineData = createInitialPipelineData();
  pipelineData.task = task;
  pauseRequested = false;
  previousPipelineState = PIPELINE_STATES.idle;
  clearConfigError();
  clearReviewInput();
  setCoordinatorSummary("Координатор инициализировал новый workflow.");
  savePipelineState();
  renderPipelineUi();
}

function resumePipeline() {
  if (pipelineState !== PIPELINE_STATES.paused) {
    return;
  }

  const resumeState = previousPipelineState || PIPELINE_STATES.idle;
  resumeAllAgents();
  setPipelineState(resumeState, `Workflow восстановлен. Активно состояние ${resumeState}.`);
  setCoordinatorSummary("Координатор восстановил workflow после паузы.");
  savePipelineState();
  renderPipelineUi();
}

async function initLessonPage() {
  setPipelineState(PIPELINE_STATES.idle, "Загружаем конфигурацию...");
  startButton.disabled = true;

  activeConfig = await loadAppConfig();
  showConfig(activeConfig);

  const validation = validateConfig(activeConfig);
  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    setPipelineState(PIPELINE_STATES.error, message);
    return;
  }

  agents = createAgents(activeConfig);
  const restored = restorePipelineState();

  if (restored) {
    taskInput.value = pipelineData.task;
    setCoordinatorSummary(
      pipelineState === PIPELINE_STATES.paused
        ? "Восстановлено сохранённое состояние workflow. Нажмите Resume для продолжения."
        : "Восстановлено сохранённое состояние lesson 13."
    );
    pipelineStatusMessage.textContent =
      pipelineState === PIPELINE_STATES.paused
        ? "Workflow восстановлен в режиме паузы."
        : "Состояние lesson 13 восстановлено из localStorage.";
  } else {
    clearPipelineState();
    setPipelineState(PIPELINE_STATES.idle, "Workflow готов к запуску.");
    setCoordinatorSummary("Координатор ожидает запуск Planner.");
  }

  renderPipelineUi();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const task = taskInput.value.trim();
  if (!task) {
    setPipelineState(PIPELINE_STATES.error, "Введите задачу перед запуском Planner.");
    return;
  }

  resetPipeline(task);
  setPipelineState(PIPELINE_STATES.idle, "Новый workflow подготовлен.");
  await runStage(STAGES.planner);
});

pauseButton.addEventListener("click", () => {
  requestPause();
});

resumeButton.addEventListener("click", () => {
  resumePipeline();
});

clearFlowButton.addEventListener("click", () => {
  clearEntireFlow();
});

sendFeedbackButton.addEventListener("click", async () => {
  await sendFeedback();
});

approveContinueButton.addEventListener("click", async () => {
  await approveAndContinue();
});

agentHistoryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const agentKey = button.dataset.agent;
    if (!agentKey || !agents[agentKey]) {
      return;
    }

    renderAgentDialog(agentKey);
    agentHistoryDialog.showModal();
  });
});

agentClearButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const agentKey = button.dataset.agent;
    if (!agentKey) {
      return;
    }

    clearAgentState(agentKey);
  });
});

clearAgentHistoryButton.addEventListener("click", () => {
  if (!activeDialogAgentKey) {
    return;
  }

  clearAgentState(activeDialogAgentKey);
});

closeAgentHistoryButton.addEventListener("click", () => {
  activeDialogAgentKey = null;
  agentHistoryDialog.close();
});

agentHistoryDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  activeDialogAgentKey = null;
  agentHistoryDialog.close();
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать lesson 13.";
  showConfigError(message);
  setPipelineState(PIPELINE_STATES.error, message);
});
