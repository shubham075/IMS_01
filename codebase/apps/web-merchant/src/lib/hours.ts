import { type Hours, WEEKDAYS } from "@idea01/schemas";

export type Day = (typeof WEEKDAYS)[number];
export interface DayHours {
  on: boolean;
  from: string;
  to: string;
}
export type HoursState = Record<Day, DayHours>;

export const defaultHours = (): HoursState =>
  Object.fromEntries(WEEKDAYS.map((d) => [d, { on: d !== "sun", from: "09:00", to: "21:00" }])) as HoursState;

export function hoursFromApi(h: Hours | undefined): HoursState {
  const state = defaultHours();
  if (!h || Object.keys(h).length === 0) return state;
  for (const d of WEEKDAYS) {
    const slot = h[d]?.[0];
    state[d] = slot ? { on: true, from: slot[0], to: slot[1] } : { ...state[d], on: false };
  }
  return state;
}

/** One continuous slot per day for now (split shifts come later). A closed day is simply left out. */
export function hoursToApi(state: HoursState): Hours {
  const out: Hours = {};
  for (const d of WEEKDAYS) if (state[d].on) out[d] = [[state[d].from, state[d].to]];
  return out;
}
