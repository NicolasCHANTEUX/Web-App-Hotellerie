const steps = ["Dates", "Hébergement", "Options", "Coordonnées", "Paiement"];

export function BookingStepper({ step }: { step: number }) {
  return (
    <ol className="booking-stepper" aria-label="Progression de la réservation">
      {steps.map((label, index) => {
        const current = index + 1;
        const complete = current < step;
        const active = current === step;
        return (
          <li key={label} className={`${complete ? "complete" : ""} ${active ? "active" : ""}`} aria-current={active ? "step" : undefined}>
            <span>{complete ? "✓" : current}</span><strong>{label}</strong>
          </li>
        );
      })}
    </ol>
  );
}
