/** Robot + drivetrain parameters. All tunable from the UI; units noted per field. */

export type RobotParams = {
  /** Chassis footprint, inches (FTC sizing box is 18 x 18). */
  width: number;
  length: number;
  massKg: number;
  /** Tile/wheel coefficient of friction — caps usable force at mu * m * g. */
  mu: number;
  /** Mecanum strafing efficiency (lateral force fraction). */
  strafeEfficiency: number;
  /** Free speed of the drivetrain, in/s. */
  freeSpeed: number;
  /** Peak motor-limited acceleration at zero speed, in/s^2. */
  stallAccel: number;
  /** Velocity loop time constant, seconds. */
  driveTau: number;
  maxAngularAccel: number; // rad/s^2
  /** Intake reach beyond the chassis front edge, inches. */
  intakeReach: number;
  /** Horizontal distance from robot centre to basket centre that a dump reliably scores from. */
  scoreReach: number;
  /** Launch speed cap for the outtake, m/s. */
  launchSpeedCap: number;
};

export const DEFAULT_ROBOT: RobotParams = {
  width: 18,
  length: 18,
  massKg: 14,
  mu: 0.85,
  strafeEfficiency: 0.78,
  freeSpeed: 72,
  stallAccel: 210,
  driveTau: 0.11,
  maxAngularAccel: 22,
  intakeReach: 9,
  scoreReach: 17,
  launchSpeedCap: 6.5,
};

/** Action durations in seconds (used by both the runtime and the evaluator). */
export const ACTION_TIME: Record<string, number> = {
  intake: 0.7,
  intake_sample: 0.7,
  intake_specimen: 0.6,
  score_high: 0.9,
  score_low: 0.7,
  specimen_high: 0.6,
  specimen_low: 0.5,
  park: 0,
  wait: 0,
};

export const POINTS = {
  netZone: 2,
  lowBasket: 4,
  highBasket: 8,
  lowChamber: 6,
  highChamber: 10,
  observationPark: 3,
  ascentLevel1: 3,
} as const;

export const AUTO_SECONDS = 30;
export const TELEOP_SECONDS = 120;
