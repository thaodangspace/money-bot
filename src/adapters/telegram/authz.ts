export class TelegramAuthorizer {
  readonly #allowedUserId: number;

  constructor(allowedUserId: number) {
    this.#allowedUserId = allowedUserId;
  }

  isAllowedPrivateChat(userId: number, chatId: number): boolean {
    return this.#allowedUserId > 0 && userId === this.#allowedUserId && chatId === userId;
  }
}
