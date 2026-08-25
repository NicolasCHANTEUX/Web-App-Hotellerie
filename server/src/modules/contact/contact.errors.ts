export class ContactApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContactApiError";
  }
}

export function invalidContact(message = "Les informations du formulaire sont invalides.") {
  return new ContactApiError(400, "INVALID_CONTACT_REQUEST", message);
}
