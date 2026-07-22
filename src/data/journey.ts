import type { JourneyEntry } from "../types/content";

// Journey/training updates, newest first isn't required — JourneyList sorts by date.
//
// COPY THIS BLOCK TO ADD A NEW ENTRY:
// {
//   slug: "kebab-case-unique-slug",
//   title: "Entry title",
//   date: "2026-08-01",
//   excerpt: "One or two sentence teaser shown on the list page.",
//   body: ["First paragraph.", "Second paragraph."],
//   coverImage: "/images/journey/your-image.jpg",
// },
export const journeyEntries: JourneyEntry[] = [
  {
    slug: "the-attempt-begins",
    title: "TODO: replace with your first real update",
    date: "2026-07-01",
    excerpt: "Placeholder excerpt — swap for a real training/prep update.",
    body: [
      "This is placeholder body text for the first journey entry.",
      "Replace this with a real update once training is underway.",
    ],
  },
];
