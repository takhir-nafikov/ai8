import { runRagAnswer } from "./rag-service.mjs";

export async function runLesson22Chat({ prompt, useRag, model, env, rootDir, runDeepSeekRequest }) {
  if (!prompt) {
    throw new Error("Field 'prompt' is required.");
  }

  if (!useRag) {
    const result = await runDeepSeekRequest({
      input: prompt,
      messages: null,
      model
    });

    return {
      ...result,
      mode: "without-rag",
      rag: null
    };
  }

  return runRagAnswer({
    prompt,
    model,
    env,
    rootDir,
    runDeepSeekRequest
  });
}
