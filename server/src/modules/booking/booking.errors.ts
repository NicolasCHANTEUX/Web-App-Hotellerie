export class BookingError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

export function invalidBooking(message = "Les informations de réservation sont invalides.") {
  return new BookingError(400, "INVALID_BOOKING", message);
}
