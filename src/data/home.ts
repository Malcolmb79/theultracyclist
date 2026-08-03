/**
 * The home page's own words.
 *
 * Kept here rather than inline in the component for the same reason as
 * about.ts and record.ts: this is copy the athlete edits, and it shouldn't
 * require reading JSX to change a sentence.
 *
 * The story below is a condensed retelling of about.ts. Same facts, fewer
 * words, because a visitor who has just landed reads a paragraph and a
 * visitor on the About page reads six. If the full version there changes,
 * this should be checked against it.
 */
export const home = {
  hero: {
    eyebrow: "New world record attempt",
    title: "Cycling Ireland, North to South.",
    subtitle:
      "568 kilometres, solo and unsupported, from Malin Head to Mizen Head. The money raised pays for heart surgery for South African children whose families cannot.",
    // Shown as a strip beneath the hero. Distance is rounded here and exact on
    // the record page, since a strip is read at a glance and 567.6 invites
    // arithmetic.
    facts: [
      { label: "Distance", value: "568 km" },
      { label: "Record to beat", value: "19h 30m" },
      { label: "Route", value: "Malin Head → Mizen Head" },
    ],
  },

  story: {
    eyebrow: "Why this ride",
    title: "The families who couldn't pay",
    // The heading names strangers, so the lead has to say how Malcolm ends up
    // riding for them. Without the last clause the heading hangs unanswered
    // until the second paragraph, which is a long way to ask a reader to wait.
    lead:
      "I'm Malcolm Barske. I set the Ireland east to west record in 2022 and I'm going after the north to south one next. Both rides are for the same reason, and it started with our own daughter.",
    paragraphs: [
      "In August 2018 our three-month-old daughter was diagnosed with Tetralogy of Fallot, a combination of heart defects she was born with. She needed open-heart surgery before her first birthday. At the angiogram the day before the operation we found out she also had five holes in her heart. She was in theatre for six hours on 7 February 2019. She is fine now.",
      "We were lucky, and we knew it, because of the four days we spent in ICU beside families who weren't. Some had lost babies in theatre. Others were facing a lifetime of medical debt, or simply couldn't pay. Without medical cover we would have had to find close to a million Rand before anyone agreed to operate on our daughter.",
      "I wanted to help one of those families and couldn't, not then. Cycling turned out to be the way I could. In July 2022 I rode 382 km from Wicklow Head to Slea Head, the fastest anyone has crossed Ireland east to west. There have been UK end to end rides since, all of them raising money for the Maboneng Foundation, who pay for these operations.",
      "Next is the full length of the country, Malin Head to Mizen Head, solo. The record stands at 19 hours 30 minutes.",
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
      body: "The route, the rules, and the time there is to beat.",
    },
    {
      to: "/the-cause",
      eyebrow: "The cause",
      title: "Where the money goes",
      body: "The Maboneng Foundation pays for heart surgery for children whose families cannot.",
    },
    {
      to: "/live",
      eyebrow: "On the day",
      title: "Follow it live",
      body: "Position, pace and time against the record, straight off the bike computer.",
    },
  ],
};
