import { useEffect, useMemo, useState } from "react";
import {
  connectSauce,
  sauceAddressForModPage,
  type FeedStatus,
  type SauceAthleteData,
  type SauceChat,
  type SauceGroup,
  type SauceRideOn,
} from "../components/race/sauceFeed";
import { groupsWithScores, onScores, prefetchEntrants, withScores } from "./racingScores";

// One Sauce connection per overlay window, subscribed only to what that
// overlay shows.

export interface ChatItem {
  id: number;
  at: number;
  kind: "chat" | "rideon";
  name: string;
  message?: string;
  to?: number;
}

let nextId = 1;
/** Chat and Ride Ons kept for the chat overlay - it shows the latest few. */
const MAX_CHAT = 100;

export function useSauce(want: { nearby?: boolean; groups?: boolean; chat?: boolean }) {
  const address = useMemo(() => sauceAddressForModPage(), []);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [watching, setWatching] = useState<SauceAthleteData | null>(null);
  const [nearby, setNearby] = useState<SauceAthleteData[]>([]);
  const [groups, setGroups] = useState<SauceGroup[]>([]);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const { nearby: wantNearby, groups: wantGroups, chat: wantChat } = want;

  useEffect(() => {
    const add = (item: Omit<ChatItem, "id" | "at">) =>
      setChat((c) => [...c, { ...item, id: nextId++, at: Date.now() }].slice(-MAX_CHAT));
    return connectSauce(address, {
      onStatus: setStatus,
      onWatching: setWatching,
      onNearby: wantNearby ? setNearby : undefined,
      onGroups: wantGroups ? setGroups : undefined,
      onChat: wantChat
        ? (c: SauceChat) =>
            c.message?.trim() &&
            add({ kind: "chat", name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || "Someone", message: c.message.trim() })
        : undefined,
      onRideOn: wantChat
        ? (r: SauceRideOn) =>
            add({ kind: "rideon", name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Someone", to: r.to })
        : undefined,
    });
  }, [address, wantNearby, wantGroups, wantChat]);

  // Racing scores Sauce hasn't got, filled in as they're looked up - the
  // whole entry list from the start pen, in a race.
  const [scored, setScored] = useState(0);
  useEffect(() => onScores(() => setScored((n) => n + 1)), []);
  const subgroup = watching?.state?.eventSubgroupId || undefined;
  useEffect(() => {
    if (subgroup && (wantNearby || wantGroups)) prefetchEntrants(address, subgroup);
  }, [address, subgroup, wantNearby, wantGroups]);
  const nearbyScored = useMemo(() => withScores(nearby), [nearby, scored]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupsScored = useMemo(() => groupsWithScores(groups), [groups, scored]); // eslint-disable-line react-hooks/exhaustive-deps

  return { address, status, watching, nearby: nearbyScored, groups: groupsScored, chat };
}
