// Exact same text as CHECKIN_TEMPLATE in api/whatsapp-webhook.ts, duplicated
// per this project's api/src decoupling convention (the client bundle and
// the Vercel functions build separately, so there's no shared module both
// sides import from) - kept byte-identical there and here since the whole
// point of a fixed check-in format is that it never drifts between the two
// places it's available (WhatsApp vs. this page's chat card).
export const CHECKIN_TEMPLATE = `*ALL CHECK INS MUST USE THIS FORMAT PLEASE* (copy paste and fill in please)

Current Weight fasted (upon waking):

Previous check in weight:

Last refeed/cheat:

Daily water intake:

Daily salt intake (gram):

Digestion daily\u{1F4A9}:

Average sleep hours:

Stress levels (1- low, 10- high):

Hunger (1-low, 10- high):

Diet followed (meals missed or eaten off plan):

Training plan followed (session missed or not):

Current cardio regime (as on your plan):

(For steroid users)
Current cycle:

(If show is relevant)
Weeks out:

Blood pressure upon waking:

Fasting Glucose:

Resting heart rate:

Measurements (as per on app):
Thigh
Stomach
Chest
Upper arm
Waist
hips
Glutes

Pictures: (posing is ideal)
-Front
-Side
-Rear`;
