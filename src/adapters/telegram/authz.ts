export class TelegramAuthorizer {
  readonly #allowedUserIds: ReadonlySet<number>;

  constructor(allowedUserIds: readonly number[]) {
    this.#allowedUserIds = new Set(allowedUserIds);
  }

  isAllowedPrivateChat(userId: number, chatId: number): boolean {
    return this.#allowedUserIds.size > 0 && this.#allowedUserIds.has(userId) && chatId === userId;
  }
}
