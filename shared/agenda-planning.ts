/** Pure layout rules shared by the agenda and its regression tests. */
export const isPendingRequest = (status: string) => ["richiesta", "in_valutazione", "proposta"].includes(status);
export const requestColor = "#ea580c";
export function planningStart<T extends { startAt: string; status: string; proposedStartAt?: string | null }>(a: T) {
  return a.status === "proposta" && a.proposedStartAt ? a.proposedStartAt : a.startAt;
}

/** Split overlapping cards into lanes, accounting for their minimum clickable height. */
export function layoutAgenda<T extends { id: number; minute: number; durationMin: number }>(
  items: T[], startMinute: number, endMinute: number, height: number,
) {
  const scale = height / (endMinute - startMinute);
  const sorted = [...items].sort((a, b) => a.minute - b.minute || a.id - b.id);
  const laneEnds: number[] = [];
  const cards = sorted.map(item => {
    const top = Math.min(height - 44, Math.max(0, (item.minute - startMinute) * scale));
    const cardHeight = Math.min(height - top, Math.max(44, item.durationMin * scale - 2));
    let lane = laneEnds.findIndex(end => end <= top);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = top + cardHeight + 2;
    return { ...item, top, height: cardHeight, lane };
  });
  return { cards, lanes: Math.max(1, laneEnds.length) };
}
