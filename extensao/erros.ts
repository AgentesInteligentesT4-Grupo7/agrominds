/**
 * Erro com mensagem para a pessoa ler: o K7 mostra `userMessage` como está (no chat, no Telegram e na página).
 * A fita não depende do código do tocador, então tem a própria classe.
 */
export class UserFacingError extends Error {
  constructor(
    public readonly userMessage: string,
    technicalMessage?: string,
    options?: { cause?: unknown },
  ) {
    super(technicalMessage ?? userMessage, options);
    this.name = new.target.name;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
