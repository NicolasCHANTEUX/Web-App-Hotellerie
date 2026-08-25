export type ContactRequestInput = {
  fullName: string;
  email: string;
  phone?: string;
  subject: "BOOKING_QUESTION" | "ARRIVAL" | "SPECIAL_REQUEST" | "OTHER";
  message: string;
  privacyAccepted: true;
};
