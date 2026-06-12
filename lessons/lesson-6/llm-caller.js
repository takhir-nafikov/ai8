/**
 * LLMCaller инкапсулирует клиентскую работу с proxy endpoint для DeepSeek.
 * Класс отвечает за подготовку тела запроса, отправку HTTP-запроса,
 * разбор успешного ответа и нормализацию ошибок в одном месте.
 */
export class LLMCaller {
  /**
   * @param {object} options Конфигурация вызывающего клиента.
   * @param {string} options.apiEndpoint URL локального proxy endpoint.
   * @param {string} options.model Имя модели, которое нужно передавать в запрос.
   */
  constructor({ apiEndpoint, model }) {
    this.apiEndpoint = apiEndpoint;
    this.model = model;
  }

  /**
   * Собирает request body для запроса к LLM.
   * @param {string} prompt Текст нового вопроса пользователя.
   * @param {Array<{role: string, content: string}>} history История диалога, которая уже есть в памяти страницы.
   * @returns {{model: string, messages: Array<{role: string, content: string}>}}
   * Возвращает JSON-объект, готовый к сериализации и отправке в proxy endpoint.
   */
  buildRequest(prompt, history = []) {
    return {
      model: this.model,
      messages: [...history, { role: "user", content: prompt }]
    };
  }

  /**
   * Показывает метаданные вызова в UI.
   * @param {string} prompt Текст нового вопроса пользователя.
   * @param {Array<{role: string, content: string}>} history История сообщений до нового запроса.
   * @returns {{callerClass: string, apiEndpoint: string, requestBody: {model: string, messages: Array<{role: string, content: string}>}}}
   * Возвращает диагностический объект: название класса, endpoint и сформированное тело запроса.
   */
  buildPreview(prompt, history = []) {
    return {
      callerClass: this.constructor.name,
      apiEndpoint: this.apiEndpoint,
      requestBody: this.buildRequest(prompt, history)
    };
  }

  /**
   * Отправляет запрос к локальному proxy endpoint и возвращает разобранный JSON-ответ.
   * @param {string} prompt Текст нового вопроса пользователя.
   * @param {Array<{role: string, content: string}>} history История сообщений до нового запроса.
   * @returns {Promise<object>}
   * Возвращает JSON, который отдаёт backend proxy: ответ модели, requestBody, usage и другие поля.
   * @throws {Error} Бросает понятную ошибку сети, конфигурации или backend-ответа.
   */
  async call(prompt, history = []) {
    if (!this.apiEndpoint) {
      throw new Error("LLMCaller: не задан apiEndpoint.");
    }

    if (!this.model) {
      throw new Error("LLMCaller: не задана модель.");
    }

    const requestBody = this.buildRequest(prompt, history);
    let response;

    try {
      response = await fetch(this.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });
    } catch (error) {
      throw new Error(
        "Не удалось отправить запрос к локальному API. Проверьте, что dev server запущен и страница открыта через http://localhost:4173.",
        { cause: error }
      );
    }

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new Error(errorPayload?.error ?? `Request failed with status ${response.status}.`);
    }

    const payload = await response.json();

    return {
      ...payload,
      requestBody: payload.requestBody ?? requestBody
    };
  }
}
