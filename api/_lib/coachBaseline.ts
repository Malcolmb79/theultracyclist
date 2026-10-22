import { getJSON } from "./kvStore.js";

// The athlete's approved training plan and the rules for applying it - the
// coach's baseline, followed as written until the athlete changes something
// in the chat. Kept in Redis rather than in the repository: the repository is
// public and the plan carries body weight, body composition and diet.
//
// `rules` is the condensed baseline that goes into every coach prompt;
// `document` is the full plan, read a section at a time through the
// read_training_plan tool.

const KV_KEY = "COACH_BASELINE";

export type CoachBaseline = {
  title: string;
  rules: string;
  document: string;
  updatedAt: string;
};

export async function getCoachBaseline(): Promise<CoachBaseline | null> {
  return getJSON<CoachBaseline>(KV_KEY).catch(() => null);
}

export const COACH_BASELINE_KEY = KV_KEY;

type Section = { id: string; title: string; text: string };

/**
 * The plan's numbered sections ("1. Weekly template" ...), with what comes
 * before them as the overview. Only the next number in sequence starts a
 * section, and never one naming plan weeks ("4. Taper W37-W39"), so the
 * numbered lists inside sections stay part of them.
 */
export function planSections(document: string): Section[] {
  const sections: Section[] = [];
  let current: Section = { id: "0", title: "Overview and history", text: "" };
  for (const line of document.split("\n")) {
    const heading = /^(\d{1,2})\.\s+([A-Z].{2,80})$/.exec(line.trim());
    if (heading && Number(heading[1]) === Number(current.id) + 1 && !/\bW\d/.test(heading[2])) {
      sections.push(current);
      current = { id: heading[1], title: heading[2], text: "" };
      continue;
    }
    current.text += `${line}\n`;
  }
  sections.push(current);
  return sections.filter((s) => s.text.trim().length > 0);
}

/** One section by number or by words from its title, or the list when nothing matches. */
export function readPlanSection(document: string, query?: string): unknown {
  const sections = planSections(document);
  const contents = sections.map((s) => `${s.id}. ${s.title}`);
  if (!query?.trim()) return { contents, note: "Ask for a section by number or title." };
  const q = query.trim().toLowerCase();
  const match =
    sections.find((s) => s.id === q.replace(/\.$/, "")) ??
    sections.find((s) => s.title.toLowerCase().includes(q)) ??
    sections.find((s) => q.split(/\s+/).every((word) => s.title.toLowerCase().includes(word)));
  return match ? { section: `${match.id}. ${match.title}`, text: match.text.trim() } : { contents, note: `No section matches "${query}".` };
}
