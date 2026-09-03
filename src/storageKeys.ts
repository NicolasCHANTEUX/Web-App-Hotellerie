export const storageKeys = {
  adminAccessToken: "hotel.admin.accessToken",
  adminExpiresAt: "hotel.admin.expiresAt",
  latestConfirmation: "hotel:latest-confirmation",
  paymentKey: (reference: string) => `hotel:payment-key:${reference}`,
} as const;

export const legacyStorageKeys = {
  adminAccessToken: "rivage.admin.accessToken",
  adminExpiresAt: "rivage.admin.expiresAt",
  latestConfirmation: "rivage:latest-confirmation",
  paymentKey: (reference: string) => `rivage:payment-key:${reference}`,
} as const;
