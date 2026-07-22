import type { Donation } from "../types/content";

// Individual donations from the BackaBuddy campaign, newest first. The daily
// scheduled sync task prepends new entries here as they come in.
//
// COPY THIS BLOCK TO ADD A NEW ENTRY (prepend to the top of the array):
// { donorName: "Name", amount: 100, currency: "ZAR", date: "2026-08-01", message: "Optional message" },
export const donations: Donation[] = [
  { donorName: "Mr Nick Meaney", amount: 200, currency: "ZAR", date: "2025-07-01", message: "Good luck" },
  {
    donorName: "Breen McInerney",
    amount: 240,
    currency: "USD",
    date: "2025-05-02",
    message:
      "Breen has generously donated half of his leaving collection to this amazing cause, good luck Malcolm. Love from Breen (and Jason)",
  },
  { donorName: "Gretta", amount: 50, currency: "USD", date: "2025-03-27", message: "Good on you Malcolm, cycle well!" },
  { donorName: "Paul Bowen", amount: 50, currency: "USD", date: "2025-03-22", message: "Extraordinary" },
  { donorName: "Michael O'Brien", amount: 1000, currency: "ZAR", date: "2025-03-21" },
  {
    donorName: "Zoran Acevski",
    amount: 50,
    currency: "USD",
    date: "2025-03-13",
    message:
      "Wow.... amazing story and ridiculous ride... I've done the math and that is one heck of a bike ride... Good luck with the training and the actual ride. Will follow you on the day!",
  },
  {
    donorName: "Breen McInerney",
    amount: 50,
    currency: "USD",
    date: "2025-03-12",
    message: "Best of lick Malcolm. Hopefully you have a gale force wide behind you !",
  },
  { donorName: "Marc Battigan", amount: 50, currency: "USD", date: "2025-03-12", message: "Amazing cause Malcolm." },
  { donorName: "Lauren C", amount: 2000, currency: "ZAR", date: "2025-03-11", message: "Best of luck Malcolm. Will be cheering you on!" },
  { donorName: "Cora N.", amount: 50, currency: "USD", date: "2025-03-11", message: "Very inspiring and I wish you every success Malcolm." },
  { donorName: "Luke B", amount: 50, currency: "USD", date: "2025-03-11", message: "Good luck Malcolm" },
  { donorName: "uday", amount: 1000, currency: "ZAR", date: "2025-03-11", message: "All the best Malcom, great cause" },
  { donorName: "Alex Bofill", amount: 500, currency: "ZAR", date: "2025-03-11", message: "Good luck with the race!" },
  { donorName: "Jelle Grammens aka homieRTCW", amount: 355, currency: "ZAR", date: "2024-02-01" },
  {
    donorName: "Dee Blue",
    amount: 2000,
    currency: "ZAR",
    date: "2023-11-20",
    message:
      "An initiative that is very close to my heart. My newborn just got diagnosed and will be undergoing OHS in two days. Malcom, thank you for doing this for our heart warriors.",
  },
  { donorName: "Niamh & Gav", amount: 869, currency: "ZAR", date: "2023-11-18", message: "Best of luck Malcom! We know you can do it 🙌🏻🙌🏻🙌🏻🙌🏻" },
  { donorName: "Bronwyn Miller", amount: 472, currency: "ZAR", date: "2023-11-11", message: "Good luck on this amazing journey Malcolm!" },
  { donorName: "Anonymous", amount: 865, currency: "ZAR", date: "2023-11-07" },
  { donorName: "Anonymous", amount: 356, currency: "ZAR", date: "2023-10-29", message: "Best of luck! Fantastic cause, hope you exceed your fundraising goal!!" },
  {
    donorName: "Jason, Laura, Annabelle & Rupert Revill",
    amount: 1800,
    currency: "ZAR",
    date: "2023-10-25",
    message:
      "I know the huge amount of effort and commitment that goes into this from you and your family, and doing this alongside our line of work is inspiring. Good luck and thank you!!",
  },
];
