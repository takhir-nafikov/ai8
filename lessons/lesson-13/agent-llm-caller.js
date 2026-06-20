import { LLMCaller } from "../lesson-6/llm-caller.js";

const AGENT_STATE = {
  idle: "IDLE",
  running: "RUNNING",
  completed: "COMPLETED",
  paused: "PAUSED",
  error: "ERROR"
};

export class AgentLLMCaller extends LLMCaller {
  constructor({ name, apiEndpoint, model, systemPrompt }) {
    super({ apiEndpoint, model });
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.history = [];
    this.state = AGENT_STATE.idle;
    this.lastOutput = "";
    this.lastError = "";
  }

  getSystemMessage() {
    return {
      role: "system",
      content: this.systemPrompt
    };
  }

  getStateLabel() {
    return this.state;
  }

  getHistory() {
    return [...this.history];
  }

  appendHistory(role, content) {
    if (!role || !content) {
      return;
    }

    this.history.push({ role, content });
  }

  pause() {
    if (this.state === AGENT_STATE.running) {
      this.state = AGENT_STATE.paused;
    }
  }

  resume() {
    if (this.state === AGENT_STATE.paused) {
      this.state = AGENT_STATE.idle;
    }
  }

  reset() {
    this.history = [];
    this.state = AGENT_STATE.idle;
    this.lastOutput = "";
    this.lastError = "";
  }

  serializeState() {
    return {
      name: this.name,
      systemPrompt: this.systemPrompt,
      history: this.history,
      state: this.state,
      lastOutput: this.lastOutput,
      lastError: this.lastError
    };
  }

  restoreState(snapshot = {}) {
    this.systemPrompt = typeof snapshot.systemPrompt === "string" ? snapshot.systemPrompt : this.systemPrompt;
    this.history = Array.isArray(snapshot.history)
      ? snapshot.history
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            role: typeof item.role === "string" ? item.role : "",
            content: typeof item.content === "string" ? item.content : ""
          }))
          .filter((item) => item.role && item.content)
      : [];
    this.state = typeof snapshot.state === "string" ? snapshot.state : AGENT_STATE.idle;
    this.lastOutput = typeof snapshot.lastOutput === "string" ? snapshot.lastOutput : "";
    this.lastError = typeof snapshot.lastError === "string" ? snapshot.lastError : "";
  }

  getTransportHistory() {
    return this.history.map((message) => ({
      role: message.role === "reviewer" ? "user" : message.role,
      content: message.content
    }));
  }

  async run(prompt) {
    this.state = AGENT_STATE.running;
    this.lastError = "";

    const historyWithSystem = [this.getSystemMessage(), ...this.getTransportHistory()];
    try {
      const result = await this.call(prompt, historyWithSystem);
      this.history.push({ role: "user", content: prompt });
      this.history.push({ role: "assistant", content: result.answer });
      this.lastOutput = result.answer;
      this.state = AGENT_STATE.completed;
      return result;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "Unknown agent error.";
      this.state = AGENT_STATE.error;
      throw error;
    }
  }
}

export { AGENT_STATE };
