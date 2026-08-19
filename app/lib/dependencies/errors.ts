/** Thrown when the target row does not exist. Routes map this to 404 via instanceof. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
