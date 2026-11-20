// All shared types for the engine. Plain data only, so everything serialises to JSON.

export type Side = "a" | "b";
export type Stance = "orthodox" | "southpaw";
export type Style = "out-boxer" | "swarmer" | "slugger" | "counter-puncher";

export interface Stats {
  power: number;
  speed: number;
  accuracy: number;
  defence: number;
  chin: number;
  stamina: number;
}

export interface BoxerBuild {
  name: string;
  nickname: string;
  stance: Stance;
  style: Style;
  stats: Stats;
}

export type Punch = "jab" | "cross" | "hook" | "uppercut" | "body";
export type Defence = "block" | "slip" | "clinch" | "move";
export type Action = Punch | Defence;
export type Tactic = "pressure" | "box" | "survive";

/** What a controller returns. During an exchange `actions` is used; in the corner `tactic` is used. */
export interface Plan {
  actions?: Action[];
  tactic?: Tactic;
  /** Optional one-line corner talk, shown as a quote. Never affects the fight. */
  talk?: string;
}

export type CutLocation = "left eyebrow" | "right eyebrow" | "forehead" | "nose";

export interface Cut {
  location: CutLocation;
  /** 1 (nick) to 5 (fight-ending). */
  severity: number;
  cause: "punch" | "clash";
  openedRound: number;
}

export interface BoxerState {
  build: BoxerBuild;
  headHealth: number; // 0-100
  bodyHealth: number; // 0-100
  stamina: number; // 0-maxStamina
  maxStamina: number;
  cuts: Cut[];
  hurt: boolean;
  tactic: Tactic;
  knockdownsRound: number;
  knockdownsTotal: number;
  clinchesRound: number;
  clinchesTotal: number;
  warnedForClinching: boolean;
  /** Point deductions, total over the fight. */
  deductions: number;
  deductionsRound: number;
}

/** Per-boxer counters for the current round, used by the judges. */
export interface RoundStats {
  thrown: number;
  landed: number;
  powerLanded: number;
  damage: number;
  blocked: number; // opponent punches this boxer blocked
  slipped: number; // opponent punches this boxer slipped
  counters: number;
  knockdownsScored: number;
}

export type EndMethod = "KO" | "TKO" | "UD" | "SD" | "MD" | "draw" | "TD";

export interface FightResult {
  winner: Side | null;
  method: EndMethod;
  round: number;
  /** Seconds into the round when it ended (180 for decisions). */
  time: number;
  reason: string;
  scorecards: Scorecard[];
}

export interface Scorecard {
  judge: string;
  bias: JudgeBias;
  rounds: { round: number; a: number; b: number }[];
  totalA: number;
  totalB: number;
}

export type JudgeBias = "aggression" | "clean punching" | "defence";

export interface FightState {
  round: number; // 1-10
  exchange: number; // 1-6, the next exchange to be fought
  a: BoxerState;
  b: BoxerState;
  roundStats: { a: RoundStats; b: RoundStats };
  scorecards: Scorecard[];
  result: FightResult | null;
}

export type HeadOrBody = "head" | "body";

/** One timed thing that happened. `t` is seconds from the start of the exchange (0-30, counts can run past 30). */
export type FightEvent =
  | { t: number; type: "action-start"; side: Side; action: Action; duration: number }
  | { t: number; type: "throw"; side: Side; punch: Punch; hand: "lead" | "rear"; counter: boolean }
  | { t: number; type: "land"; side: Side; punch: Punch; target: HeadOrBody; damage: number; counter: boolean }
  | { t: number; type: "block"; side: Side; punch: Punch } // side = the blocker
  | { t: number; type: "slip"; side: Side; punch: Punch } // side = the one who slipped
  | { t: number; type: "miss"; side: Side; punch: Punch } // side = the puncher
  | { t: number; type: "smothered"; side: Side; punch: Punch } // punch never got off because of a clinch
  | { t: number; type: "clinch"; side: Side }
  | { t: number; type: "break"; side: Side }
  | { t: number; type: "warning"; side: Side; reason: string }
  | { t: number; type: "deduction"; side: Side; points: number; reason: string }
  | { t: number; type: "head-clash" }
  | { t: number; type: "hurt"; side: Side }
  | { t: number; type: "cut-opened"; side: Side; location: CutLocation; cause: "punch" | "clash" }
  | { t: number; type: "cut-worsened"; side: Side; location: CutLocation; severity: number }
  | { t: number; type: "knockdown"; side: Side; punch: Punch | null }
  | { t: number; type: "count"; side: Side; count: number }
  | { t: number; type: "get-up"; side: Side; count: number }
  | { t: number; type: "counted-out"; side: Side }
  | { t: number; type: "stoppage"; side: Side; by: "referee" | "doctor" | "three knockdowns"; reason: string }
  | { t: number; type: "round-end"; round: number }
  | { t: number; type: "doctor-check"; side: Side; location: CutLocation; severity: number; allowed: boolean }
  | { t: number; type: "cut-treated"; side: Side; location: CutLocation; severity: number }
  | { t: number; type: "round-scored"; round: number; cards: { judge: string; a: number; b: number }[] };

export interface ExchangeOutcome {
  state: FightState;
  events: FightEvent[];
  /** Seconds of playback this exchange needs (30, or more if a count ran on). */
  duration: number;
}
