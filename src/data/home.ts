/**
 * The home page's own words.
 *
 * Kept here rather than inline in the component for the same reason as
 * about.ts and record.ts: this is copy the athlete edits, and it shouldn't
 * require reading JSX to change a sentence.
 *
 * The story below is a condensed retelling of about.ts - same facts, fewer
 * words, because a visitor who has just landed reads a paragraph and a
 * visitor on the About page reads six. If the full version there changes,
 * this should be checked against it.
 */
export const home = {
  hero: {
    eyebrow: "New world record attempt",
    title: "Cycling Ireland, North to South.",
    subtitle:
      "568 kilometres, solo and unsupported, from Malin Head to Mizen Head — raising money for children born with heart defects who can't afford the surgery that would save them.",
    // The target is the front page's most interesting number now that there is
    // a real one to print: Mervyn Kinkade's 19h 30m, set 24 July 2023 and
    // verified by WUCA. Distance is rounded here and exact on the record page,
    // since a hero strip is read at a glance and 567.6 invites arithmetic.
    facts: [
      { label: "Distance", value: "568 km" },
      { label: "Record to beat", value: "19h 30m" },
      { label: "Route", value: "Malin Head → Mizen Head" },
    ],
  },

  story: {
    eyebrow: "Why this ride",
    title: "It started in a hospital corridor",
    lead:
      "I'm Malcolm Barske. In 2022 I set a world record cycling across Ireland east to west. This is the story of why I keep doing it, and what the next one is for.",
    paragraphs: [
      "In August 2018 our three-month-old daughter was diagnosed with Tetralogy of Fallot — a combination of heart defects she was born with. She needed open-heart surgery before her first birthday. The day before the operation we found out she also had five holes in her heart. On 7 February 2019 she came through six hours in theatre, and she is fine.",
      "We were lucky, and we knew it because of the four days we spent in ICU beside families who weren't. Some had lost babies in theatre. Others were facing a lifetime of medical debt, or simply couldn't pay. Without medical cover we would have had to find close to a million Rand before anyone agreed to operate on our daughter.",
      "I wanted to help one of those families. Cycling turned out to be the way I could. In July 2022 I rode 382 km from Wicklow Head to Slea Head — the fastest anyone has crossed Ireland east to west — and I've taken on UK end-to-end challenges since, each one raising money for the Maboneng Foundation, who sponsor these surgeries for South African children.",
      "Now it's the full length of the country: Malin Head to Mizen Head, north to south, solo. Every kilometre of it is for the next child on that list.",
    ],
    // Sits under the story, before the link out.
    pullQuote: "10,000 babies are born with a heart defect in South Africa each year. Around 700 get the surgery.",
  },

  // The three things a first-time visitor can actually do, shown as cards
  // beneath the story. The live tracker is deliberately last: it's the most
  // interesting one during the attempt and the least interesting before it.
  paths: [
    {
      to: "/the-record",
      eyebrow: "The attempt",
      title: "What the record takes",
      body: "The route, the rules, the clock, and what has to go right over 570 km.",
    },
    {
      to: "/the-cause",
      eyebrow: "The cause",
      title: "Where the money goes",
      body: "The Maboneng Foundation funds heart surgery for children whose families can't.",
    },
    {
      to: "/live",
      eyebrow: "On the day",
      title: "Follow it live",
      body: "Position, pace and time against the record, straight off the bike computer.",
    },
  ],
};
