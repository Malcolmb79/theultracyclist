/**
 * Which Apple Health field is actually body weight.
 *
 * Server-side twin of the matcher in src/utils/bmi.ts, kept separate the way
 * this project keeps the api and frontend projects apart - but the two must
 * agree, or the dashboard and the coach will read different fields as "weight".
 */
const WEIGHT_NAME_PATTERN = /weight|body_mass/i;
// Body mass, and nothing that merely mentions it. Apple Health also exports
// "body_mass_index" (a unitless number around 25) and "lean_body_mass", both of
// which match a naive /body_mass/ - and the day body_mass_index first appeared
// the BMI widget read 25.4 as a weight in kilograms and reported a BMI of 8.9,
// "underweight", from a figure that was already the BMI.
const WEIGHT_EXCLUDE = /index|bmi|lean|percent/i;

export function isWeightFieldName(name: string): boolean {
  return WEIGHT_NAME_PATTERN.test(name) && !WEIGHT_EXCLUDE.test(name);
}
