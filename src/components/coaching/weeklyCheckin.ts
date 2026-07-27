// Ordered questions for the Coaching page's interactive "Weekly check-in"
// flow (see CoachChatCard.tsx) - same fields, same order, as the static
// template WhatsApp's "checkin" trigger returns (CHECKIN_TEMPLATE in
// api/whatsapp-webhook.ts), just asked one at a time instead of dumped as
// a single fill-in-the-blanks block. Pictures aren't asked here - there's
// no photo upload in this chat, so buildWeeklyCheckinMessage appends a
// plain reminder for those instead.
export const WEEKLY_CHECKIN_QUESTIONS: string[] = [
  "Current Weight fasted (upon waking):",
  "Previous check in weight:",
  "Last refeed/cheat:",
  "Daily water intake:",
  "Daily salt intake (gram):",
  "Digestion daily\u{1F4A9}:",
  "Average sleep hours:",
  "Stress levels (1- low, 10- high):",
  "Hunger (1-low, 10- high):",
  "Diet followed (meals missed or eaten off plan):",
  "Training plan followed (session missed or not):",
  "Current cardio regime (as on your plan):",
  "(For steroid users) Current cycle:",
  "(If show is relevant) Weeks out:",
  "Blood pressure upon waking:",
  "Fasting Glucose:",
  "Resting heart rate:",
  "Thigh measurement:",
  "Stomach measurement:",
  "Chest measurement:",
  "Upper arm measurement:",
  "Waist measurement:",
  "Hips measurement:",
  "Glutes measurement:",
];

const MEASUREMENT_START_INDEX = 17; // "Thigh measurement:" onward, see above

// Assembles the collected answers back into the same field order/structure
// as the static WhatsApp template, so whoever receives it (via
// api/send-checkin.ts) sees a familiar, consistent format regardless of
// whether it came from WhatsApp directly or this page.
export function buildWeeklyCheckinMessage(answers: string[]): string {
  const lines: string[] = ["*Weekly check-in*", ""];

  WEEKLY_CHECKIN_QUESTIONS.forEach((question, i) => {
    const answer = answers[i]?.trim() || "-";
    if (i === MEASUREMENT_START_INDEX) {
      lines.push("Measurements (as per on app):");
    }
    if (i >= MEASUREMENT_START_INDEX) {
      // "Thigh measurement:" -> "Thigh" - matches the template's own
      // "Thigh 56.6" style (name + value, no colon) for this section.
      const name = question.replace(" measurement:", "");
      lines.push(`${name} ${answer}`);
    } else {
      lines.push(`${question} ${answer}`);
      lines.push("");
    }
  });

  lines.push("", "Pictures: (posing is ideal)", "-Front", "-Side", "-Rear");
  return lines.join("\n");
}
